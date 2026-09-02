import pino from 'pino';
import { config } from '../config.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: undefined,
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});
