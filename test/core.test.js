import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { TokenService } from '../src/auth/token-service.js';
import { StorageService } from '../src/services/storage-service.js';
import { DesignService } from '../src/services/design-service.js';
import { AiService } from '../src/services/ai-service.js';

const validEnvironment = {
  DATABASE_URL: 'mysql://roomcraft:roomcraft@localhost:3306/roomcraft',
  JWT_SECRET: '12345678901234567890123456789012',
  R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'access',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'roomcraft',
  OPENAI_API_KEY: 'test-key',
};

test('configuration loads secure defaults and rejects short JWT secrets', () => {
  const config = loadConfig(validEnvironment);
  assert.equal(config.port, 3000);
  assert.equal(config.credits.initial, 30);
  assert.equal(config.r2.maxRoomImageBytes, 20_971_520);
  assert.equal(config.worker.maxAttempts, 3);
  assert.throws(
    () => loadConfig({ ...validEnvironment, JWT_SECRET: 'short' }),
    /at least 32 characters/,
  );
  assert.throws(
    () => loadConfig({ ...validEnvironment, DATABASE_URL: 'postgresql://localhost/roomcraft' }),
    /must start with mysql:\/\//,
  );
});

test('JWTs enforce issuer, audience, signature, and subject', () => {
  const config = loadConfig(validEnvironment);
  const tokens = new TokenService(config);
  const userId = `user_${'a'.repeat(32)}`;
  assert.deepEqual(tokens.verify(tokens.sign(userId)), { userId });
  const otherTokens = new TokenService({ jwt: { secret: 'x'.repeat(32), expiresIn: '7d' } });
  assert.throws(() => otherTokens.verify(tokens.sign(userId)), /Invalid or expired/);
});

test('R2 upload URLs are signed locally and keys are user-scoped', async () => {
  const config = loadConfig(validEnvironment);
  const storage = new StorageService(config);
  const userId = `user_${'a'.repeat(32)}`;
  const result = await storage.createRoomUpload(userId, {
    fileName: 'room.jpg',
    contentType: 'image/jpeg',
  });
  assert.match(result.imageKey, new RegExp(`^rooms/${userId}/room_[a-f0-9]{32}/original\\.jpg$`));
  assert.match(result.uploadUrl, /^https:\/\/(roomcraft\.)?account\.r2\.cloudflarestorage\.com\//);
  assert.match(result.uploadUrl, /X-Amz-Signature=/i);
  assert.match(result.uploadUrl, /X-Amz-SignedHeaders=content-type%3Bhost/i);
  assert.doesNotMatch(result.uploadUrl, /x-amz-checksum/i);
  assert.equal(result.imageUrl, undefined);
});

function designPool(credits = 10) {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push([sql, params]);
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: null, rows: [] };
      if (sql.startsWith('SELECT id FROM rooms')) return { rowCount: 1, rows: [{ id: `room_${'b'.repeat(32)}` }] };
      if (sql.startsWith('SELECT credits FROM users')) return { rowCount: 1, rows: [{ credits }] };
      if (sql.includes('INSERT INTO design_jobs')) {
        return {
          rowCount: 1,
          rows: [{
            id: params[0],
            room_id: params[2],
            status: 'queued',
            progress: '0',
            error_message: null,
          }],
        };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  return { pool: { connect: async () => client }, calls };
}

test('design creation reserves the exact credit cost in one transaction', async () => {
  const { pool, calls } = designPool(10);
  const service = new DesignService(pool, {}, { previewPerVariant: 1, finalPerVariant: 3 });
  const result = await service.create(`user_${'a'.repeat(32)}`, {
    roomId: `room_${'b'.repeat(32)}`,
    style: 'Scandinavian',
    palette: ['white'],
    preserve: ['windows'],
    instructions: 'Calm and functional',
    variants: 2,
    quality: 'preview',
  });
  assert.equal(result.status, 'queued');
  const jobInsert = calls.find(([sql]) => sql.includes('INSERT INTO design_jobs'));
  assert.equal(jobInsert[1][9], 2);
  const balanceUpdate = calls.find(([sql]) => sql.startsWith('UPDATE users SET credits'));
  assert.deepEqual(balanceUpdate[1], [8, `user_${'a'.repeat(32)}`]);
  assert.equal(calls.at(-1)[0], 'COMMIT');
});

test('design creation rolls back when credits are insufficient', async () => {
  const { pool, calls } = designPool(1);
  const service = new DesignService(pool, {}, { previewPerVariant: 1, finalPerVariant: 3 });
  await assert.rejects(() => service.create(`user_${'a'.repeat(32)}`, {
    roomId: `room_${'b'.repeat(32)}`,
    style: 'Modern',
    palette: [],
    preserve: [],
    instructions: 'Redesign',
    variants: 2,
    quality: 'preview',
  }), (error) => error.statusCode === 402);
  assert.equal(calls.at(-1)[0], 'ROLLBACK');
});

test('OpenAI service sends structured vision input and preservation-grade image edit options', async () => {
  let analysisRequest;
  let editRequest;
  const client = {
    responses: {
      create(params) {
        analysisRequest = params;
        return { withResponse: async () => ({
          request_id: 'req_analysis',
          data: {
            output_text: JSON.stringify({ roomTypeEstimate: 'living room' }),
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        }) };
      },
    },
    images: {
      edit(params) {
        editRequest = params;
        return { withResponse: async () => ({
          request_id: 'req_image',
          data: {
            data: [{ b64_json: Buffer.from('generated').toString('base64') }],
            usage: { input_tokens: 20, output_tokens: 30 },
          },
        }) };
      },
    },
  };
  const ai = new AiService({
    openai: {
      apiKey: 'test',
      visionModel: 'vision-model',
      imageModel: 'gpt-image-2',
      imageSize: '1536x1024',
      inputCostPerMillionUsd: 10,
      outputCostPerMillionUsd: 20,
    },
  }, client);
  const input = { buffer: Buffer.from('image'), contentType: 'image/jpeg', userId: 'user_123' };
  const analysis = await ai.analyzeRoom(input);
  const edit = await ai.editRoom({ ...input, prompt: 'preserve geometry', variants: 1, quality: 'final' });
  assert.equal(analysis.requestId, 'req_analysis');
  assert.equal(analysisRequest.text.format.type, 'json_schema');
  assert.match(analysisRequest.input[0].content[1].image_url, /^data:image\/jpeg;base64,/);
  assert.equal(Object.hasOwn(editRequest, 'input_fidelity'), false);
  assert.equal(editRequest.quality, 'high');
  assert.equal(editRequest.output_format, 'jpeg');
  assert.equal(edit.images[0].toString(), 'generated');
  assert.equal(ai.estimateCost([analysis.usage, edit.usage]), 0.001);
});
