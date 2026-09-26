import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import {
  authenticate,
  errorHandler,
  notFoundHandler,
  requestContext,
  validate,
} from './http/middleware.js';
import {
  createDesignSchema,
  designIdSchema,
  loginSchema,
  projectSchema,
  registerSchema,
  roomSchema,
  uploadUrlSchema,
} from './http/schemas.js';

export function createApp({ config, services, pool }) {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(helmet());
  app.use(cors({
    origin: config.corsOrigins === '*' ? '*' : config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-Request-Id'],
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.nodeEnv === 'test' ? 10_000 : 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again later.' },
  }));

  app.get('/health', (_request, response) => response.json({ status: 'ok' }));
  app.get('/ready', async (_request, response) => {
    await pool.query('SELECT 1');
    response.json({ status: 'ready' });
  });

  const api = express.Router();
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.nodeEnv === 'test' ? 10_000 : 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Too many authentication attempts. Please try again later.' },
  });

  api.post('/auth/register', authLimiter, validate(registerSchema), async (request, response) => {
    response.status(201).json(await services.auth.register(request.body));
  });
  api.post('/auth/login', authLimiter, validate(loginSchema), async (request, response) => {
    response.json(await services.auth.login(request.body));
  });

  api.use(authenticate(services.tokenService));
  api.get('/users/me', async (request, response) => {
    response.json(await services.users.me(request.auth.userId));
  });
  api.get('/projects', async (request, response) => {
    response.json(await services.projects.list(request.auth.userId));
  });
  api.post('/projects', validate(projectSchema), async (request, response) => {
    response.status(201).json(await services.projects.create(request.auth.userId, request.body));
  });
  api.post('/rooms/upload-url', validate(uploadUrlSchema), async (request, response) => {
    response.json(await services.rooms.createUploadUrl(request.auth.userId, request.body));
  });
  api.post('/rooms', validate(roomSchema), async (request, response) => {
    response.status(201).json(await services.rooms.create(request.auth.userId, request.body));
  });
  api.post('/designs', validate(createDesignSchema(config.maxDesignVariants)), async (request, response) => {
    response.status(202).json(await services.designs.create(request.auth.userId, request.body));
  });
  api.get('/designs/:id', validate(designIdSchema, 'params'), async (request, response) => {
    response.json(await services.designs.get(request.auth.userId, request.params.id));
  });

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler(config.nodeEnv === 'production'));
  return app;
}

