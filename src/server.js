import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { createServices } from './services/index.js';
import { createApp } from './app.js';
import { DesignWorker } from './worker/design-worker.js';
import { logger } from './lib/logger.js';

export async function startServer() {
  const config = loadConfig();
  const pool = createPool(config);

  if (config.runMigrations) await runMigrations(pool);
  else await pool.query('SELECT 1');

  const services = createServices(pool, config);
  const app = createApp({ config, services, pool });
  const worker = new DesignWorker({ pool, storage: services.storage, ai: services.ai, config });
  const server = app.listen(config.port, () => {
    logger.info('RoomCraft API is listening', { port: config.port, environment: config.nodeEnv });
  });
  if (config.runWorker) worker.start();

  let closing = false;
  const close = async (signal) => {
    if (closing) return;
    closing = true;
    logger.info('Shutting down', { signal });
    const forceTimer = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30_000).unref();
    const serverClosed = new Promise((resolve) => server.close(resolve));
    server.closeIdleConnections?.();
    await worker.stop();
    await serverClosed;
    await pool.end();
    clearTimeout(forceTimer);
  };
  process.once('SIGINT', () => close('SIGINT'));
  process.once('SIGTERM', () => close('SIGTERM'));
  return { app, server, worker, pool, close };
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  startServer().catch((error) => {
    logger.error('Server failed to start', { error: error.message, stack: error.stack });
    process.exitCode = 1;
  });
}
