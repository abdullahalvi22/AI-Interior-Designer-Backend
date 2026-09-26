import bcrypt from 'bcryptjs';
import { conflict, unauthorized } from '../lib/errors.js';
import { createId } from '../lib/ids.js';

function mapUser(row) {
  return { id: row.id, name: row.name, email: row.email, credits: row.credits };
}

export class AuthService {
  constructor(pool, tokenService, initialCredits) {
    this.pool = pool;
    this.tokenService = tokenService;
    this.initialCredits = initialCredits;
  }

  async register({ name, email, password }) {
    const passwordHash = await bcrypt.hash(password, 12);
    const id = createId('user');
    let row;
    try {
      await this.pool.query(
        `INSERT INTO users(id, name, email, password_hash, credits)
         VALUES (?, ?, ?, ?, ?)`,
        [id, name, email, passwordHash, this.initialCredits],
      );
      row = { id, name, email, credits: this.initialCredits };
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
        throw conflict('An account with this email already exists');
      }
      throw error;
    }
    return { accessToken: this.tokenService.sign(row.id), user: mapUser(row) };
  }

  async login({ email, password }) {
    const result = await this.pool.query(
      'SELECT id, name, email, password_hash, credits FROM users WHERE email = ?',
      [email],
    );
    const row = result.rows[0];
    const valid = row && await bcrypt.compare(password, row.password_hash);
    if (!valid) throw unauthorized('Invalid email or password');
    return { accessToken: this.tokenService.sign(row.id), user: mapUser(row) };
  }
}
