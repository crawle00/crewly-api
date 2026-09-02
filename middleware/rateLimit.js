import rateLimit from 'express-rate-limit';
import { AppError } from './errors.js';

const handler = (_req, _res, next) =>
  next(new AppError('RATE_LIMITED', 429, 'Too many requests, please try again later'));

export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler,
});
