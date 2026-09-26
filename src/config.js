import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined)
  .pipe(z.url().optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid MySQL URL').refine(
    (value) => value.startsWith('mysql://'),
    'DATABASE_URL must start with mysql://',
  ),
  DATABASE_SSL: booleanFromString,
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGINS: z.string().default('*'),
  TRUST_PROXY: booleanFromString,
  R2_ENDPOINT: z.url('R2_ENDPOINT must be a URL'),
  R2_ACCESS_KEY_ID: z.string().min(1, 'R2_ACCESS_KEY_ID is required'),
  R2_SECRET_ACCESS_KEY: z.string().min(1, 'R2_SECRET_ACCESS_KEY is required'),
  R2_BUCKET: z.string().min(1, 'R2_BUCKET is required'),
  R2_PUBLIC_BASE_URL: optionalUrl,
  R2_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  R2_READ_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  VERIFY_R2_UPLOADS: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  MAX_ROOM_IMAGE_BYTES: z.coerce.number().int().min(1_000_000).max(50_000_000).default(20_971_520),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_VISION_MODEL: z.string().default('gpt-5.6-luna'),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-2'),
  OPENAI_IMAGE_SIZE: z.string().regex(/^\d+x\d+$|^auto$/).default('auto'),
  OPENAI_INPUT_COST_PER_MILLION_USD: z.coerce.number().min(0).default(0),
  OPENAI_OUTPUT_COST_PER_MILLION_USD: z.coerce.number().min(0).default(0),
  DEFAULT_USER_CREDITS: z.coerce.number().int().min(0).default(30),
  PREVIEW_CREDITS_PER_VARIANT: z.coerce.number().int().min(1).default(1),
  FINAL_CREDITS_PER_VARIANT: z.coerce.number().int().min(1).default(3),
  MAX_DESIGN_VARIANTS: z.coerce.number().int().min(1).max(10).default(4),
  RUN_MIGRATIONS: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  RUN_WORKER: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(2000),
  WORKER_STALE_AFTER_SECONDS: z.coerce.number().int().min(60).default(900),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(3),
  WORKER_RETRY_BASE_SECONDS: z.coerce.number().int().min(1).default(10),
});

export function loadConfig(environment = process.env) {
  const result = schema.safeParse(environment);
  if (!result.success) {
    const messages = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${messages.join('\n')}`);
  }

  const env = result.data;
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    database: { url: env.DATABASE_URL, ssl: env.DATABASE_SSL },
    jwt: { secret: env.JWT_SECRET, expiresIn: env.JWT_EXPIRES_IN },
    corsOrigins: env.CORS_ORIGINS === '*'
      ? '*'
      : env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
    trustProxy: env.TRUST_PROXY,
    r2: {
      endpoint: env.R2_ENDPOINT,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET,
      publicBaseUrl: env.R2_PUBLIC_BASE_URL,
      uploadTtlSeconds: env.R2_UPLOAD_URL_TTL_SECONDS,
      readTtlSeconds: env.R2_READ_URL_TTL_SECONDS,
      verifyUploads: env.VERIFY_R2_UPLOADS,
      maxRoomImageBytes: env.MAX_ROOM_IMAGE_BYTES,
    },
    openai: {
      apiKey: env.OPENAI_API_KEY,
      visionModel: env.OPENAI_VISION_MODEL,
      imageModel: env.OPENAI_IMAGE_MODEL,
      imageSize: env.OPENAI_IMAGE_SIZE,
      inputCostPerMillionUsd: env.OPENAI_INPUT_COST_PER_MILLION_USD,
      outputCostPerMillionUsd: env.OPENAI_OUTPUT_COST_PER_MILLION_USD,
    },
    credits: {
      initial: env.DEFAULT_USER_CREDITS,
      previewPerVariant: env.PREVIEW_CREDITS_PER_VARIANT,
      finalPerVariant: env.FINAL_CREDITS_PER_VARIANT,
    },
    maxDesignVariants: env.MAX_DESIGN_VARIANTS,
    runMigrations: env.RUN_MIGRATIONS,
    runWorker: env.RUN_WORKER,
    worker: {
      pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
      staleAfterSeconds: env.WORKER_STALE_AFTER_SECONDS,
      maxAttempts: env.WORKER_MAX_ATTEMPTS,
      retryBaseSeconds: env.WORKER_RETRY_BASE_SECONDS,
    },
  };
}
