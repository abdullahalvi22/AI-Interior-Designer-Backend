import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const ids = {
  user: `user_${'a'.repeat(32)}`,
  project: `project_${'b'.repeat(32)}`,
  room: `room_${'c'.repeat(32)}`,
  job: `job_${'d'.repeat(32)}`,
  design: `design_${'e'.repeat(32)}`,
};

function fixture() {
  const calls = [];
  const services = {
    tokenService: {
      verify(token) {
        if (token !== 'test-token') throw Object.assign(new Error('Invalid or expired access token'), { statusCode: 401 });
        return { userId: ids.user };
      },
    },
    auth: {
      async register(input) {
        calls.push(['register', input]);
        return { accessToken: 'jwt', user: { id: ids.user, ...input, password: undefined, credits: 30 } };
      },
      async login(input) {
        calls.push(['login', input]);
        return { accessToken: 'jwt', user: { id: ids.user, name: 'Demo', email: input.email, credits: 30 } };
      },
    },
    users: {
      async me(userId) {
        calls.push(['me', userId]);
        return { id: userId, name: 'Demo', email: 'demo@example.com', credits: 29 };
      },
    },
    projects: {
      async list(userId) {
        calls.push(['listProjects', userId]);
        return [{ id: ids.project, name: 'Apartment', createdAt: '2026-08-25T06:00:00.000Z' }];
      },
      async create(userId, input) {
        calls.push(['createProject', userId, input]);
        return { id: ids.project, name: input.name, createdAt: '2026-08-25T06:00:00.000Z' };
      },
    },
    rooms: {
      async createUploadUrl(userId, input) {
        calls.push(['uploadUrl', userId, input]);
        return {
          uploadUrl: 'https://r2.example.test/upload',
          imageKey: `rooms/${ids.user}/${ids.room}/original.jpg`,
        };
      },
      async create(userId, input) {
        calls.push(['createRoom', userId, input]);
        return {
          id: ids.room,
          projectId: input.projectId,
          name: input.name,
          roomType: input.roomType,
          originalImageKey: input.originalImageKey,
          originalImageUrl: 'https://r2.example.test/read',
        };
      },
    },
    designs: {
      async create(userId, input) {
        calls.push(['createDesign', userId, input]);
        return { id: ids.job, roomId: input.roomId, status: 'queued', progress: 0, designs: [] };
      },
      async get(userId, jobId) {
        calls.push(['getDesign', userId, jobId]);
        return {
          id: jobId,
          roomId: ids.room,
          status: 'completed',
          progress: 1,
          designs: [{
            id: ids.design,
            imageUrl: 'https://r2.example.test/design.jpg',
            style: 'Scandinavian',
            prompt: 'traceable prompt',
          }],
        };
      },
    },
  };
  const config = {
    nodeEnv: 'test',
    trustProxy: false,
    corsOrigins: '*',
    maxDesignVariants: 4,
  };
  const pool = { query: async () => ({ rows: [{ '?column?': 1 }] }) };
  return { app: createApp({ config, services, pool }), calls };
}

const authenticated = (method, app, path) => request(app)[method](path).set('Authorization', 'Bearer test-token');

test('health and readiness endpoints respond', async () => {
  const { app } = fixture();
  await request(app).get('/health').expect(200, { status: 'ok' });
  await request(app).get('/ready').expect(200, { status: 'ready' });
});

test('register normalizes input and returns the contract shape', async () => {
  const { app, calls } = fixture();
  const response = await request(app).post('/api/auth/register').send({
    name: ' Demo Designer ',
    email: 'DEMO@EXAMPLE.COM',
    password: 'password123',
  }).expect(201);
  assert.equal(response.body.accessToken, 'jwt');
  assert.equal(response.body.user.id, ids.user);
  assert.deepEqual(calls[0][1], {
    name: 'Demo Designer',
    email: 'demo@example.com',
    password: 'password123',
  });
});

test('login validates malformed requests', async () => {
  const { app } = fixture();
  await request(app).post('/api/auth/login').send({ email: 'bad', password: '' })
    .expect(400)
    .expect(({ body }) => assert.match(body.message, /email/i));
});

test('authenticated endpoints reject a missing bearer token', async () => {
  const { app } = fixture();
  await request(app).get('/api/users/me').expect(401, { message: 'Authentication required' });
});

test('user and project endpoints implement the documented responses', async () => {
  const { app } = fixture();
  const me = await authenticated('get', app, '/api/users/me').expect(200);
  assert.equal(me.body.credits, 29);

  const projects = await authenticated('get', app, '/api/projects').expect(200);
  assert.equal(projects.body[0].id, ids.project);

  const created = await authenticated('post', app, '/api/projects').send({ name: ' Apartment refresh ' }).expect(201);
  assert.equal(created.body.name, 'Apartment refresh');
});

test('room upload URL and metadata endpoints implement the two-step upload flow', async () => {
  const { app } = fixture();
  const upload = await authenticated('post', app, '/api/rooms/upload-url').send({
    fileName: 'living-room.jpg',
    contentType: 'image/jpeg',
  }).expect(200);
  assert.equal(upload.body.imageKey, `rooms/${ids.user}/${ids.room}/original.jpg`);

  const room = await authenticated('post', app, '/api/rooms').send({
    projectId: ids.project,
    name: 'Living room',
    roomType: 'living_room',
    originalImageKey: upload.body.imageKey,
    originalImageUrl: 'https://ignored.example.test/image.jpg',
  }).expect(201);
  assert.equal(room.body.id, ids.room);
  assert.equal(room.body.roomType, 'living_room');
});

test('design creation and polling endpoints match the contract', async () => {
  const { app } = fixture();
  const queued = await authenticated('post', app, '/api/designs').send({
    roomId: ids.room,
    style: 'Scandinavian',
    palette: ['warm white', 'light oak', 'sage'],
    preserve: ['room geometry', 'windows', 'doors', 'floor'],
    instructions: 'Create a calm, functional space with realistic furniture scale.',
    variants: 2,
    quality: 'preview',
  }).expect(202);
  assert.equal(queued.body.status, 'queued');
  assert.deepEqual(queued.body.designs, []);

  const completed = await authenticated('get', app, `/api/designs/${ids.job}`).expect(200);
  assert.equal(completed.body.status, 'completed');
  assert.equal(completed.body.progress, 1);
  assert.equal(completed.body.designs.length, 1);
});

test('design validation enforces variant limits and rejects unknown fields', async () => {
  const { app } = fixture();
  await authenticated('post', app, '/api/designs').send({
    roomId: ids.room,
    style: 'Modern',
    instructions: 'Redesign it',
    variants: 5,
    quality: 'preview',
  }).expect(400);
  await authenticated('post', app, '/api/projects').send({ name: 'One', ownerId: ids.user }).expect(400);
});

test('unknown endpoints use the standard error shape', async () => {
  const { app } = fixture();
  await authenticated('get', app, '/api/nope').expect(404, { message: 'Endpoint not found' });
});
