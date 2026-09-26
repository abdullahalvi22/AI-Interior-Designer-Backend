import { unauthorized } from '../lib/errors.js';

export class UserService {
  constructor(pool) {
    this.pool = pool;
  }

  async me(userId) {
    const result = await this.pool.query(
      'SELECT id, name, email, credits FROM users WHERE id = ?',
      [userId],
    );
    if (!result.rows[0]) throw unauthorized('Account no longer exists');
    return result.rows[0];
  }
}
