export class AppError extends Error {
  constructor(statusCode, message, options = {}) {
    super(message, options);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = options.code;
    this.expose = options.expose ?? statusCode < 500;
  }
}

export const badRequest = (message) => new AppError(400, message);
export const unauthorized = (message = 'Authentication required') => new AppError(401, message);
export const forbidden = (message = 'You do not have access to this resource') => new AppError(403, message);
export const notFound = (message = 'Resource not found') => new AppError(404, message);
export const conflict = (message) => new AppError(409, message);

export function publicError(error, isProduction) {
  if (error instanceof AppError) {
    return { statusCode: error.statusCode, message: error.expose ? error.message : 'Internal server error' };
  }

  if (error?.type === 'entity.parse.failed') {
    return { statusCode: 400, message: 'Request body must be valid JSON' };
  }

  if (error?.type === 'entity.too.large') {
    return { statusCode: 413, message: 'Request body is too large' };
  }

  return {
    statusCode: 500,
    message: isProduction ? 'Internal server error' : (error?.message || 'Internal server error'),
  };
}

