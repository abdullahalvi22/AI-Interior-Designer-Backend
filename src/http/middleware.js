import { randomUUID } from 'node:crypto';
import { publicError, unauthorized } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function requestContext(request, response, next) {
  request.id = request.get('x-request-id') || randomUUID();
  response.set('x-request-id', request.id);
  const startedAt = performance.now();
  response.on('finish', () => {
    logger.info('HTTP request completed', {
      requestId: request.id,
      method: request.method,
      path: request.originalUrl,
      statusCode: response.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
    });
  });
  next();
}

export function authenticate(tokenService) {
  return (request, _response, next) => {
    try {
      const header = request.get('authorization');
      if (!header?.startsWith('Bearer ')) throw unauthorized();
      const token = header.slice('Bearer '.length).trim();
      if (!token) throw unauthorized();
      request.auth = tokenService.verify(token);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function validate(schema, source = 'body') {
  return (request, _response, next) => {
    const result = schema.safeParse(request[source]);
    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
      next(new (class ValidationError extends Error {
        constructor() {
          super(`${path}${issue.message}`);
          this.statusCode = 400;
          this.expose = true;
        }
      })());
      return;
    }
    request[source] = result.data;
    next();
  };
}

export function notFoundHandler(_request, _response, next) {
  const error = new Error('Endpoint not found');
  error.statusCode = 404;
  error.expose = true;
  next(error);
}

export function errorHandler(isProduction) {
  return (error, request, response, _next) => {
    const normalized = error.statusCode
      ? {
          statusCode: error.statusCode,
          message: error.expose === false || (isProduction && error.statusCode >= 500)
            ? 'Internal server error'
            : error.message,
        }
      : publicError(error, isProduction);

    if (normalized.statusCode >= 500) {
      logger.error('Request failed', {
        requestId: request.id,
        method: request.method,
        path: request.originalUrl,
        error: error.message,
        stack: isProduction ? undefined : error.stack,
      });
    }

    if (response.headersSent) return;
    response.status(normalized.statusCode).json({ message: normalized.message });
  };
}

