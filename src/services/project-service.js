import { createId } from '../lib/ids.js';

function mapProject(row) {
  const createdAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  return { id: row.id, name: row.name, createdAt: createdAt.toISOString() };
}

export class ProjectService {
  constructor(pool) {
    this.pool = pool;
  }

  async list(userId) {
    const result = await this.pool.query(
      `SELECT id, name, created_at FROM projects
       WHERE user_id = ? ORDER BY created_at DESC, id DESC`,
      [userId],
    );
    return result.rows.map(mapProject);
  }

  async create(userId, { name }) {
    const id = createId('project');
    await this.pool.query(
      'INSERT INTO projects(id, user_id, name) VALUES (?, ?, ?)',
      [id, userId, name],
    );
    const result = await this.pool.query(
      'SELECT id, name, created_at FROM projects WHERE id = ? AND user_id = ?',
      [id, userId],
    );
    return mapProject(result.rows[0]);
  }
}
