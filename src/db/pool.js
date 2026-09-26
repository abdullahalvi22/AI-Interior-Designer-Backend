import mysql from 'mysql2/promise';

function normalizeResult(result) {
  if (Array.isArray(result)) {
    return { rows: result, rowCount: result.length, affectedRows: 0, insertId: undefined };
  }
  return {
    rows: [],
    rowCount: result.affectedRows || 0,
    affectedRows: result.affectedRows || 0,
    insertId: result.insertId,
  };
}

function wrapQueryable(queryable, release) {
  return {
    async query(sql, parameters = []) {
      const [result] = await queryable.query(sql, parameters);
      return normalizeResult(result);
    },
    release,
  };
}

export function createPool(config) {
  const url = new URL(config.database.url);
  const nativePool = mysql.createPool({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    ssl: config.database.ssl ? { rejectUnauthorized: true } : undefined,
    waitForConnections: true,
    connectionLimit: 20,
    maxIdle: 20,
    idleTimeout: 30_000,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    charset: 'utf8mb4',
    timezone: 'Z',
  });
  nativePool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'", (error) => {
      if (error) connection.destroy();
    });
  });

  return {
    ...wrapQueryable(nativePool),
    async connect() {
      const connection = await nativePool.getConnection();
      return wrapQueryable(connection, () => connection.release());
    },
    end: () => nativePool.end(),
    on: (event, listener) => nativePool.on(event, listener),
  };
}

export async function withTransaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
