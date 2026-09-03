import { HttpError } from '../lib/errors.js';
import { toDependencyError } from '../lib/dependency-errors.js';

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  });
}

function serialize(error) {
  const body = { code: error.code, message: error.message };
  if (error.details !== undefined) body.details = error.details;
  return { error: body };
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof HttpError) {
    return res.status(err.status).json(serialize(err));
  }

  const dependencyError = toDependencyError(err);
  if (dependencyError) {
    req.log?.warn({ err }, dependencyError.message);
    return res.status(dependencyError.status).json(serialize(dependencyError));
  }

  // Express marks its own client errors (malformed paths, bad encodings) as
  // exposable. Anything else carrying a status, such as an Elasticsearch
  // response error, is an internal failure and must not reach the client.
  const status = Number(err?.status ?? err?.statusCode);
  const exposable = err?.expose === true || err instanceof URIError;
  if (exposable && Number.isInteger(status) && status >= 400 && status < 500) {
    return res.status(status).json({ error: { code: 'BAD_REQUEST', message: err.message } });
  }

  req.log?.error({ err }, 'Unhandled error');
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
}
