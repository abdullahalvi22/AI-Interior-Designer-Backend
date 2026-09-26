import { AppError, notFound } from '../lib/errors.js';
import { createId } from '../lib/ids.js';
import { withTransaction } from '../db/pool.js';

function mapJob(row, designs = []) {
  return {
    id: row.id,
    roomId: row.room_id,
    status: row.status,
    progress: Number(row.progress),
    designs,
    ...(row.status === 'failed' && row.error_message ? { errorMessage: row.error_message } : {}),
  };
}

export class DesignService {
  constructor(pool, storage, creditConfig) {
    this.pool = pool;
    this.storage = storage;
    this.creditConfig = creditConfig;
  }

  async create(userId, input) {
    const creditCost = input.variants * (
      input.quality === 'final'
        ? this.creditConfig.finalPerVariant
        : this.creditConfig.previewPerVariant
    );

    return withTransaction(this.pool, async (client) => {
      const room = await client.query(
        'SELECT id FROM rooms WHERE id = ? AND user_id = ?',
        [input.roomId, userId],
      );
      if (!room.rowCount) throw notFound('Room not found');

      const userResult = await client.query(
        'SELECT credits FROM users WHERE id = ? FOR UPDATE',
        [userId],
      );
      if (!userResult.rowCount) throw notFound('User not found');
      const currentCredits = userResult.rows[0].credits;
      if (currentCredits < creditCost) {
        throw new AppError(402, `Not enough credits. This design requires ${creditCost} credits.`);
      }

      const id = createId('job');
      await client.query(
        `INSERT INTO design_jobs(
           id, user_id, room_id, style, palette, preserve_items, instructions,
           variants, quality, credit_cost
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          userId,
          input.roomId,
          input.style,
          JSON.stringify(input.palette),
          JSON.stringify(input.preserve),
          input.instructions,
          input.variants,
          input.quality,
          creditCost,
        ],
      );
      const balance = currentCredits - creditCost;
      await client.query(
        'UPDATE users SET credits = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
        [balance, userId],
      );
      await client.query(
        `INSERT INTO credit_transactions(
           id, user_id, job_id, kind, amount, balance_after, description
         ) VALUES (?, ?, ?, 'design_charge', ?, ?, ?)`,
        [createId('credit'), userId, id, -creditCost, balance, `Reserved credits for ${input.variants} design variant(s)`],
      );
      return mapJob({
        id,
        room_id: input.roomId,
        status: 'queued',
        progress: 0.15,
        error_message: null,
      });
    });
  }

  async get(userId, jobId) {
    const jobResult = await this.pool.query(
      `SELECT id, room_id, status, progress, error_message
       FROM design_jobs WHERE id = ? AND user_id = ?`,
      [jobId, userId],
    );
    if (!jobResult.rowCount) throw notFound('Design job not found');

    const designResult = jobResult.rows[0].status === 'completed'
      ? await this.pool.query(
          `SELECT id, image_key, image_url, style, prompt
           FROM designs WHERE job_id = ? AND user_id = ? ORDER BY variant_index`,
          [jobId, userId],
        )
      : { rows: [] };
    const designs = await Promise.all(designResult.rows.map(async (row) => ({
      id: row.id,
      imageUrl: row.image_url || await this.storage.getReadUrl(row.image_key),
      style: row.style,
      prompt: row.prompt,
    })));
    return mapJob(jobResult.rows[0], designs);
  }
}
