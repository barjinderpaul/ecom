import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSearchBody, productsIndexMappings, SEARCH_FIELDS } from '../src/search/products-index.js';

describe('buildSearchBody', () => {
  it('builds a relevance query with pagination and no filter by default', () => {
    const body = buildSearchBody({ query: 'phone', from: 20, size: 10 });
    assert.equal(body.from, 20);
    assert.equal(body.size, 10);
    assert.equal(body.track_total_hits, true);
    assert.deepEqual(body._source, { excludes: ['reviews'] });
    assert.equal(body.query.bool.must[0].multi_match.query, 'phone');
    assert.deepEqual(body.query.bool.must[0].multi_match.fields, SEARCH_FIELDS);
    assert.equal('filter' in body.query.bool, false);
    assert.deepEqual(body.sort, [{ _score: 'desc' }, { id: 'asc' }]);
  });

  it('adds an exact category filter when a category is given', () => {
    const body = buildSearchBody({ query: 'phone', category: 'smartphones', from: 0, size: 20 });
    assert.deepEqual(body.query.bool.filter, [{ term: { category: 'smartphones' } }]);
  });

  it('never searches review text', () => {
    const fields = [
      ...SEARCH_FIELDS,
      ...buildSearchBody({ query: 'x', from: 0, size: 1 }).query.bool.should[0].multi_match.fields,
    ];
    assert.equal(
      fields.some((field) => field.startsWith('reviews')),
      false,
    );
  });
});

describe('productsIndexMappings', () => {
  it('rejects unmapped fields so document drift fails loudly', () => {
    assert.equal(productsIndexMappings.dynamic, 'strict');
  });

  it('maps every searched field', () => {
    const top = productsIndexMappings.properties;
    for (const spec of SEARCH_FIELDS) {
      const [path] = spec.split('^');
      const [field, sub] = path.split('.');
      assert.ok(top[field], `${field} is mapped`);
      if (sub) assert.ok(top[field].fields?.[sub], `${path} is mapped`);
    }
  });
});
