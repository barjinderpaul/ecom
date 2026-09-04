import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listProductsQuerySchema, productIdParamsSchema } from '../src/routes/schemas.js';

const parse = (schema, input) => schema.safeParse(input);

describe('listProductsQuerySchema', () => {
  it('applies defaults when parameters are absent or blank', () => {
    for (const input of [
      {},
      { page: '', limit: '', category: '', query: '  ' },
      { page: '  ', limit: ' ' },
    ]) {
      const { success, data } = parse(listProductsQuerySchema, input);
      assert.equal(success, true);
      assert.equal(data.page, 1);
      assert.equal(data.limit, 20);
      assert.equal(data.category, undefined);
      assert.equal(data.query, undefined);
    }
  });

  it('coerces numeric strings and normalises category and query', () => {
    const { data } = parse(listProductsQuerySchema, {
      page: '3',
      limit: '50',
      category: ' Mens-Shoes ',
      query: ' phone ',
    });
    assert.deepEqual(data, { page: 3, limit: 50, category: 'mens-shoes', query: 'phone' });
  });

  it('parses rating and price filters as numbers', () => {
    const { data } = parse(listProductsQuerySchema, { minRating: '4', minPrice: '9.99', maxPrice: '100' });
    assert.equal(data.minRating, 4);
    assert.equal(data.minPrice, 9.99);
    assert.equal(data.maxPrice, 100);
  });

  for (const [name, input] of [
    ['page=0', { page: '0' }],
    ['page=-1', { page: '-1' }],
    ['page=abc', { page: 'abc' }],
    ['page=1.5', { page: '1.5' }],
    ['page=1e3', { page: '1e3' }],
    ['page too large', { page: '1000001' }],
    ['limit=0', { limit: '0' }],
    ['limit=101', { limit: '101' }],
    ['repeated page', { page: ['1', '2'] }],
    ['repeated category', { category: ['a', 'b'] }],
    ['category with spaces', { category: 'mens shoes' }],
    ['category with symbols', { category: 'beauty;drop' }],
    ['category leading dash', { category: '-beauty' }],
    ['query too long', { query: 'x'.repeat(201) }],
    ['repeated query', { query: ['a', 'b'] }],
    ['minRating above 5', { minRating: '5.5' }],
    ['negative minPrice', { minPrice: '-1' }],
    ['minPrice with three decimals', { minPrice: '1.999' }],
    ['non-numeric maxPrice', { maxPrice: 'ten' }],
    ['maxPrice below minPrice', { minPrice: '10', maxPrice: '5' }],
  ]) {
    it(`rejects ${name}`, () => {
      assert.equal(parse(listProductsQuerySchema, input).success, false);
    });
  }

  it('ignores unknown parameters', () => {
    const { data } = parse(listProductsQuerySchema, { sort: 'price' });
    assert.equal('sort' in data, false);
  });
});

describe('productIdParamsSchema', () => {
  it('accepts positive integers', () => {
    assert.deepEqual(parse(productIdParamsSchema, { id: '42' }).data, { id: 42 });
    assert.deepEqual(parse(productIdParamsSchema, { id: '4294967295' }).data, { id: 4294967295 });
  });

  for (const id of ['0', '-1', 'abc', '1.5', '01', '1e2', '4294967296', '99999999999', ' 1', '']) {
    it(`rejects "${id}"`, () => {
      assert.equal(parse(productIdParamsSchema, { id }).success, false);
    });
  }
});
