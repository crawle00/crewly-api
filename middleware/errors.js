export class AppError extends Error {
  constructor(code, status, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

export const badRequest = (message, details) => new AppError('BAD_REQUEST', 400, message, details);
export const unauthorized = (message = 'Unauthorized') => new AppError('UNAUTHORIZED', 401, message);
export const forbidden = (message = 'Forbidden') => new AppError('FORBIDDEN', 403, message);
export const notFound = (message = 'Not found') => new AppError('NOT_FOUND', 404, message);
export const conflict = (message, details) => new AppError('CONFLICT', 409, message, details);

export function notFoundHandler(_req, _res, next) {
  next(notFound());
}

export function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) {
    const body = { error: { code: err.code, message: err.message } };
    if (err.details !== undefined) body.error.details = err.details;
    return res.status(err.status).json(body);
  }

  console.error(err);
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Internal server error' },
  });
}
