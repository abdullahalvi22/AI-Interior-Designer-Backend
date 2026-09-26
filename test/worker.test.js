import test from 'node:test';
import assert from 'node:assert/strict';
import { DesignWorker } from '../src/worker/design-worker.js';

const ids = {
  user: `user_${'a'.repeat(32)}`,
  room: `room_${'b'.repeat(32)}`,
  job: `job_${'c'.repeat(32)}`,
};

function workerFixture({ maxAttempts = 3, failAnalysis = false } = {}) {
  const calls = [];
  let candidateAvailable = true;
  const job = {
    id: ids.job,
    user_id: ids.user,
    room_id: ids.room,
    status: 'queued',
    progress: 0.15,
    style: 'Scandinavian',
    palette: ['warm white'],
    preserve_items: ['windows'],
    instructions: 'Keep it calm and functional.',
    variants: 1,
    quality: 'preview',
    credit_cost: 1,
    attempts: 0,
  };

  async function query(sql, params = []) {
    calls.push([sql, params]);
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(compact)) return { rows: [], rowCount: 0 };
    if (compact.startsWith('SELECT id, attempts FROM design_jobs')) return { rows: [], rowCount: 0 };
    if (compact.startsWith('SELECT * FROM design_jobs')) {
      if (!candidateAvailable) return { rows: [], rowCount: 0 };
      candidateAvailable = false;
      return { rows: [job], rowCount: 1 };
    }
    if (compact.startsWith('SELECT original_image_key FROM rooms')) {
      return { rows: [{ original_image_key: `rooms/${ids.user}/${ids.room}/original.jpg` }], rowCount: 1 };
    }
    if (compact.startsWith('SELECT user_id, credit_cost, status FROM design_jobs')) {
      return { rows: [{ user_id: ids.user, credit_cost: 1, status: 'analyzing_room' }], rowCount: 1 };
    }
    if (compact.startsWith('SELECT credits FROM users')) return { rows: [{ credits: 29 }], rowCount: 1 };
    if (compact.startsWith('SELECT id FROM credit_transactions')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  }

  const pool = {
    query,
    connect: async () => ({ query, release() {} }),
  };
  const storage = {
    getImage: async () => ({ buffer: Buffer.from('room'), contentType: 'image/jpeg' }),
    putDesign: async (key) => `https://cdn.example.test/${key}`,
  };
  const analysis = {
    roomTypeEstimate: 'living room',
    architecture: ['rectangular'],
    fixedElements: ['window'],
    materials: ['wood'],
    lighting: ['daylight'],
    spatialNotes: ['clear walkway'],
    preservationRisks: ['window position'],
  };
  const ai = {
    analyzeRoom: failAnalysis
      ? async () => { throw new Error('provider unavailable'); }
      : async () => ({ analysis, requestId: 'req_analysis', usage: { input_tokens: 10 } }),
    editRoom: async () => ({
      images: [Buffer.from('design')],
      requestId: 'req_image',
      usage: { output_tokens: 20 },
    }),
    estimateCost: () => 0.01,
  };
  const worker = new DesignWorker({
    pool,
    storage,
    ai,
    config: {
      worker: {
        pollIntervalMs: 250,
        staleAfterSeconds: 900,
        maxAttempts,
        retryBaseSeconds: 1,
      },
    },
    logger: { info() {}, error() {} },
  });
  return { worker, calls };
}

test('MySQL worker claims and completes a design with transactional locking', async () => {
  const { worker, calls } = workerFixture();
  assert.equal(await worker.runOnce(), true);

  assert.ok(calls.some(([sql]) => sql.includes('FOR UPDATE SKIP LOCKED')));
  assert.ok(calls.some(([sql]) => sql.includes('ON DUPLICATE KEY UPDATE')));
  const completed = calls.find(([, params]) => params[0] === 'completed');
  assert.ok(completed);
  assert.equal(completed[1][1], 1);
  assert.equal(calls.filter(([sql]) => sql === 'BEGIN').length, 2);
  assert.equal(calls.filter(([sql]) => sql === 'COMMIT').length, 2);
});

test('final MySQL worker failure refunds credits once and marks the job failed', async () => {
  const { worker, calls } = workerFixture({ maxAttempts: 1, failAnalysis: true });
  assert.equal(await worker.runOnce(), true);

  assert.ok(calls.some(([sql]) => sql.includes("'design_refund'")));
  const creditUpdate = calls.find(([sql]) => sql.startsWith('UPDATE users SET credits'));
  assert.deepEqual(creditUpdate[1], [30, ids.user]);
  assert.ok(calls.some(([sql]) => sql.includes("status = 'failed'")));
  assert.equal(calls.at(-1)[0], 'COMMIT');
});
