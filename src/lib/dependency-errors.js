import { errors as esErrors } from '@elastic/elasticsearch';
import { ServiceUnavailableError } from './errors.js';

const MYSQL_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ER_NO_SUCH_TABLE',
  'ER_CON_COUNT_ERROR',
]);

/**
 * Maps infrastructure failures (database or search cluster unreachable, index
 * not built yet) to a 503 so clients can distinguish "retry later" from a bug.
 * Returns null for anything else.
 */
export function toDependencyError(err) {
  if (
    err instanceof esErrors.ConnectionError ||
    err instanceof esErrors.TimeoutError ||
    err instanceof esErrors.NoLivingConnectionsError
  ) {
    return new ServiceUnavailableError('Search backend is unavailable');
  }
  if (err instanceof esErrors.ResponseError) {
    const type = err.meta?.body?.error?.type;
    if (type === 'index_not_found_exception') {
      return new ServiceUnavailableError('Search index has not been built yet');
    }
    if (err.meta?.statusCode === 503 || err.meta?.statusCode === 429) {
      return new ServiceUnavailableError('Search backend is unavailable');
    }
    return null;
  }
  if (typeof err?.code === 'string' && MYSQL_UNAVAILABLE_CODES.has(err.code)) {
    return new ServiceUnavailableError('Database is unavailable');
  }
  return null;
}
