import 'dotenv/config';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { StorageService } from './services/storage-service.js';
import { AiService } from './services/ai-service.js';
import { DesignWorker } from './worker/design-worker.js';
import { logger } from './lib/logger.js';

const config = loadConfig();
const pool = createPool(config);
if (config.runMigrations) await runMigrations(pool);
const worker = new DesignWorker({
  pool,
  storage: new StorageService(config),
  ai: new AiService(config),
  config,
});
worker.start();

async function shutdown(signal) {
  logger.info('Worker process shutting down', { signal });
  await worker.stop();
  await pool.end();
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

