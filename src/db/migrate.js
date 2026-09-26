import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { loadConfig } from '../config.js';
import { createPool } from './pool.js';
import { logger } from '../lib/logger.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = join(here, '..', '..', 'migrations');

export async function runMigrations(pool) {
  const client = await pool.connect();
  try {
    const lock = await client.query('SELECT GET_LOCK(?, 30) AS acquired', ['roomcraft_migrations']);
    if (Number(lock.rows[0]?.acquired) !== 1) throw new Error('Could not acquire the migration lock');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name varchar(255) PRIMARY KEY,
        applied_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    const files = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE name = ?', [file]);
      if (applied.rowCount) continue;

      const sql = await readFile(join(migrationsDirectory, file), 'utf8');
      // MySQL DDL commits implicitly, so migration files are restart-safe.
      const statements = sql.split(';').map((statement) => statement.trim()).filter(Boolean);
      for (const statement of statements) await client.query(statement);
      await client.query('INSERT INTO schema_migrations(name) VALUES (?)', [file]);
      logger.info('Applied database migration', { migration: file });
    }
  } finally {
    await client.query('SELECT RELEASE_LOCK(?)', ['roomcraft_migrations']).catch(() => {});
    client.release();
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const config = loadConfig();
  const pool = createPool(config);
  runMigrations(pool)
    .then(() => logger.info('Database is up to date'))
    .catch((error) => {
      logger.error('Migration failed', { error: error.message });
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
