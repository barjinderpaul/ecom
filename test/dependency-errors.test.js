import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { errors as esErrors } from '@elastic/elasticsearch';
import { toDependencyError } from '../src/lib/dependency-errors.js';

const responseError = (statusCode, type) =>
  new esErrors.ResponseError({ statusCode, body: { error: { type } }, headers: {}, warnings: [], meta: {} });

describe('toDependencyError', () => {
  it('maps Elasticsearch connectivity failures to 503', () => {
    for (const err of [
      new esErrors.ConnectionError('x'),
      new esErrors.TimeoutError('x'),
      responseError(503, 'x'),
    ]) {
      const mapped = toDependencyError(err);
      assert.equal(mapped.status, 503);
      assert.equal(mapped.message, 'Search backend is unavailable');
    }
  });

  it('reports a missing index as not seeded', () => {
    const mapped = toDependencyError(responseError(404, 'index_not_found_exception'));
    assert.equal(mapped.status, 503);
    assert.equal(mapped.message, 'Search index has not been built yet');
  });

  it('leaves other Elasticsearch responses to the generic handler', () => {
    assert.equal(toDependencyError(responseError(400, 'parsing_exception')), null);
  });

  it('maps MySQL connectivity and missing schema errors to 503', () => {
    assert.equal(
      toDependencyError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })).message,
      'Database is unavailable',
    );
    assert.equal(
      toDependencyError(Object.assign(new Error('x'), { code: 'ER_NO_SUCH_TABLE' })).message,
      'Database has not been seeded yet',
    );
  });

  it('ignores unrelated errors', () => {
    assert.equal(toDependencyError(new Error('boom')), null);
    assert.equal(toDependencyError(Object.assign(new Error('x'), { code: 'ER_DUP_ENTRY' })), null);
    assert.equal(toDependencyError(null), null);
  });
});
