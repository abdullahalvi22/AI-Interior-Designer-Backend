import jwt from 'jsonwebtoken';
import { unauthorized } from '../lib/errors.js';

export class TokenService {
  constructor(config) {
    this.secret = config.jwt.secret;
    this.expiresIn = config.jwt.expiresIn;
  }

  sign(userId) {
    return jwt.sign({}, this.secret, {
      algorithm: 'HS256',
      subject: userId,
      issuer: 'roomcraft-api',
      audience: 'roomcraft-app',
      expiresIn: this.expiresIn,
    });
  }

  verify(token) {
    try {
      const payload = jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: 'roomcraft-api',
        audience: 'roomcraft-app',
      });
      if (!payload.sub) throw new Error('Missing subject');
      return { userId: payload.sub };
    } catch {
      throw unauthorized('Invalid or expired access token');
    }
  }
}

