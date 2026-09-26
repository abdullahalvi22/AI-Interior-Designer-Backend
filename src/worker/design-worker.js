import { randomUUID } from 'node:crypto';
import { createId } from '../lib/ids.js';
import { withTransaction } from '../db/pool.js';
import { logger as defaultLogger } from '../lib/logger.js';
import { buildDesignPrompt } from './prompt.js';

function delay(milliseconds, signal) {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

function safeErrorMessage() {
  return 'AI design generation failed. Reserved credits were refunded.';
}

export class DesignWorker {
  constructor({ pool, storage, ai, config, logger = defaultLogger }) {
    this.pool = pool;
    this.storage = storage;
    this.ai = ai;
    this.config = config.worker;
    this.ownerId = `worker-${process.pid}-${randomUUID()}`;
    this.logger = logger;
    this.running = false;
    this.abortController = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.abortController = new AbortController();
    this.loopPromise = this.#loop(this.abortController.signal);
    this.logger.info('Design worker started', { workerId: this.ownerId });
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    this.abortController.abort();
    await this.loopPromise;
    this.logger.info('Design worker stopped', { workerId: this.ownerId });
  }

  async #loop(signal) {
    while (this.running && !signal.aborted) {
      try {
        const worked = await this.runOnce();
        if (!worked) await delay(this.config.pollIntervalMs, signal);
      } catch (error) {
        this.logger.error('Design worker loop error', { error: error.message, stack: error.stack });
        await delay(this.config.pollIntervalMs, signal);
      }
    }
  }

  async runOnce() {
    const exhaustedJob = await this.#claimExhaustedStaleJob();
    if (exhaustedJob) {
      this.logger.error('Failing stale design job after maximum attempts', { jobId: exhaustedJob.id });
      await this.#retryOrFail(exhaustedJob);
      return true;
    }
    const job = await this.#claim();
    if (!job) return false;
    try {
      await this.#process(job);
    } catch (error) {
      this.logger.error('Design job attempt failed', {
        jobId: job.id,
        attempt: job.attempts,
        error: error.message,
        stack: error.stack,
      });
      await this.#retryOrFail(job, error);
    }
    return true;
  }

  async #claimExhaustedStaleJob() {
    return withTransaction(this.pool, async (client) => {
      const candidate = await client.query(
        `SELECT id, attempts FROM design_jobs
         WHERE status IN ('analyzing_room', 'generating_images')
           AND attempts >= ?
           AND locked_at < TIMESTAMPADD(SECOND, ?, CURRENT_TIMESTAMP(3))
         ORDER BY locked_at
         LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [this.config.maxAttempts, -this.config.staleAfterSeconds],
      );
      const job = candidate.rows[0];
      if (!job) return null;
      await client.query(
        `UPDATE design_jobs SET
           locked_by = ?, locked_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [this.ownerId, job.id],
      );
      return job;
    });
  }

  async #claim() {
    return withTransaction(this.pool, async (client) => {
      const candidate = await client.query(
        `SELECT * FROM design_jobs
         WHERE attempts < ?
           AND (
             (status = 'queued' AND available_at <= CURRENT_TIMESTAMP(3))
             OR (
               status IN ('analyzing_room', 'generating_images')
               AND locked_at < TIMESTAMPADD(SECOND, ?, CURRENT_TIMESTAMP(3))
             )
           )
         ORDER BY created_at
         LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [this.config.maxAttempts, -this.config.staleAfterSeconds],
      );
      const job = candidate.rows[0];
      if (!job) return null;
      await client.query(
        `UPDATE design_jobs SET
           status = 'queued', progress = 0.15, attempts = attempts + 1,
           locked_at = CURRENT_TIMESTAMP(3), locked_by = ?,
           updated_at = CURRENT_TIMESTAMP(3), error_message = NULL
         WHERE id = ?`,
        [this.ownerId, job.id],
      );
      const roomResult = await client.query(
        `SELECT original_image_key FROM rooms
         WHERE id = ? AND user_id = ?`,
        [job.room_id, job.user_id],
      );
      if (!roomResult.rowCount) throw new Error('Room no longer exists');
      return {
        ...job,
        status: 'queued',
        progress: 0.15,
        attempts: Number(job.attempts) + 1,
        error_message: null,
        original_image_key: roomResult.rows[0].original_image_key,
      };
    });
  }

  async #setProgress(jobId, status, progress, fields = {}) {
    const values = [status, progress];
    const updates = ['status = ?', 'progress = ?', 'updated_at = CURRENT_TIMESTAMP(3)'];
    if (!Object.hasOwn(fields, 'locked_at')) updates.push('locked_at = CURRENT_TIMESTAMP(3)');
    const jsonColumns = new Set(['room_analysis', 'openai_image_request_ids', 'openai_usage']);
    for (const [column, value] of Object.entries(fields)) {
      values.push(jsonColumns.has(column) && value !== null ? JSON.stringify(value) : value);
      updates.push(`${column} = ?`);
    }
    values.push(jobId, this.ownerId);
    const result = await this.pool.query(
      `UPDATE design_jobs SET ${updates.join(', ')} WHERE id = ? AND locked_by = ?`,
      values,
    );
    if (!result.rowCount) throw new Error('Design job lock was lost');
  }

  async #process(job) {
    await this.#setProgress(job.id, 'analyzing_room', 0.3);
    const original = await this.storage.getImage(job.original_image_key);
    const analysisResult = await this.ai.analyzeRoom({
      ...original,
      userId: job.user_id,
    });
    const prompt = buildDesignPrompt(job, analysisResult.analysis);

    await this.#setProgress(job.id, 'generating_images', 0.55, {
      room_analysis: analysisResult.analysis,
      final_prompt: prompt,
      openai_analysis_request_id: analysisResult.requestId,
    });
    const editResult = await this.ai.editRoom({
      ...original,
      prompt,
      variants: job.variants,
      quality: job.quality,
      userId: job.user_id,
    });

    for (let index = 0; index < editResult.images.length; index += 1) {
      const imageKey = `designs/${job.user_id}/${job.id}/variant-${index + 1}.jpg`;
      const imageUrl = await this.storage.putDesign(imageKey, editResult.images[index], 'image/jpeg');
      await this.pool.query(
        `INSERT INTO designs(
           id, job_id, user_id, variant_index, image_key, image_url, style, prompt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) AS new
         ON DUPLICATE KEY UPDATE
           image_key = new.image_key,
           image_url = new.image_url,
           style = new.style,
           prompt = new.prompt`,
        [createId('design'), job.id, job.user_id, index + 1, imageKey, imageUrl || null, job.style, prompt],
      );
      await this.#setProgress(
        job.id,
        'generating_images',
        0.55 + (0.4 * (index + 1) / editResult.images.length),
      );
    }

    const usage = { analysis: analysisResult.usage, image: editResult.usage };
    const actualCost = this.ai.estimateCost([analysisResult.usage, editResult.usage]);
    await this.#setProgress(job.id, 'completed', 1, {
      openai_image_request_ids: [editResult.requestId].filter(Boolean),
      openai_usage: usage,
      actual_ai_cost_usd: actualCost,
      completed_at: new Date(),
      locked_at: null,
      locked_by: null,
    });
    this.logger.info('Design job completed', { jobId: job.id, variants: job.variants });
  }

  async #retryOrFail(job) {
    if (job.attempts < this.config.maxAttempts) {
      const retryInSeconds = this.config.retryBaseSeconds * (2 ** (job.attempts - 1));
      await this.pool.query(
        `UPDATE design_jobs SET
           status = 'queued', progress = 0, error_message = NULL,
           available_at = TIMESTAMPADD(SECOND, ?, CURRENT_TIMESTAMP(3)),
           locked_at = NULL, locked_by = NULL, updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND locked_by = ?`,
        [retryInSeconds, job.id, this.ownerId],
      );
      return;
    }

    await withTransaction(this.pool, async (client) => {
      const jobResult = await client.query(
        'SELECT user_id, credit_cost, status FROM design_jobs WHERE id = ? FOR UPDATE',
        [job.id],
      );
      const currentJob = jobResult.rows[0];
      if (!currentJob || ['completed', 'failed'].includes(currentJob.status)) return;

      const userResult = await client.query('SELECT credits FROM users WHERE id = ? FOR UPDATE', [currentJob.user_id]);
      const currentCredits = userResult.rows[0]?.credits;
      if (currentCredits === undefined) throw new Error('Job owner no longer exists');
      const balance = currentCredits + currentJob.credit_cost;
      const existingRefund = await client.query(
        `SELECT id FROM credit_transactions
         WHERE job_id = ? AND kind = 'design_refund'`,
        [job.id],
      );
      if (!existingRefund.rowCount) {
        await client.query(
        `INSERT INTO credit_transactions(
           id, user_id, job_id, kind, amount, balance_after, description
         ) VALUES (?, ?, ?, 'design_refund', ?, ?, 'Refund for failed design job')`,
          [createId('credit'), currentJob.user_id, job.id, currentJob.credit_cost, balance],
        );
        await client.query(
          'UPDATE users SET credits = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
          [balance, currentJob.user_id],
        );
      }
      await client.query(
        `UPDATE design_jobs SET
           status = 'failed', progress = 1, error_message = ?,
           completed_at = CURRENT_TIMESTAMP(3), locked_at = NULL, locked_by = NULL,
           updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [safeErrorMessage(), job.id],
      );
    });
  }
}
