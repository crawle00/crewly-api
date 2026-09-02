import { AppError } from './errors.js';

const toDetails = (error) =>
  error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));

export function validate(schemas) {
  const targets = Object.entries(schemas);

  return (req, _res, next) => {
    for (const [target, schema] of targets) {
      const result = schema.safeParse(req[target]);
      if (!result.success) {
        return next(new AppError('VALIDATION_FAILED', 400, 'Request validation failed', toDetails(result.error)));
      }
      if (target === 'body') {
        req.body = result.data;
      } else {
        Object.defineProperty(req, target, { value: result.data, writable: true, configurable: true });
      }
    }
    next();
  };
}
