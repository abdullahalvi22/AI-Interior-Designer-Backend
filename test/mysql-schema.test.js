import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../migrations/001_initial.sql', import.meta.url);

test('initial migration defines the complete MySQL schema', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)]
    .map((match) => match[1])
    .filter((name) => name !== 'schema_migrations')
    .sort();

  assert.deepEqual(tables, [
    'credit_transactions',
    'design_jobs',
    'designs',
    'projects',
    'rooms',
    'users',
  ]);
  assert.match(sql, /ENGINE=InnoDB/g);
  assert.match(sql, /DEFAULT CHARSET=utf8mb4/g);
  assert.match(sql, /FOR(?:EIGN)? KEY \(user_id\) REFERENCES users\(id\)/i);
  assert.match(sql, /UNIQUE KEY designs_job_variant_uq \(job_id, variant_index\)/i);
  assert.match(sql, /UNIQUE KEY credit_transactions_job_kind_uq \(job_id, kind\)/i);
  assert.match(sql, /palette json NOT NULL/i);
});

test('application SQL no longer contains PostgreSQL-only syntax', async () => {
  const files = [
    migrationUrl,
    new URL('../src/services/auth-service.js', import.meta.url),
    new URL('../src/services/user-service.js', import.meta.url),
    new URL('../src/services/project-service.js', import.meta.url),
    new URL('../src/services/room-service.js', import.meta.url),
    new URL('../src/services/design-service.js', import.meta.url),
    new URL('../src/worker/design-worker.js', import.meta.url),
  ];
  const source = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');

  assert.doesNotMatch(source, /\$\d+/);
  assert.doesNotMatch(source, /\bjsonb\b/i);
  assert.doesNotMatch(source, /\btimestamptz\b/i);
  assert.doesNotMatch(source, /\bON CONFLICT\b/i);
  assert.doesNotMatch(source, /\bRETURNING\b/i);
  assert.doesNotMatch(source, /::(?:int|json)/i);
  assert.match(source, /ON DUPLICATE KEY UPDATE/i);
  assert.match(source, /FOR UPDATE SKIP LOCKED/i);
});
