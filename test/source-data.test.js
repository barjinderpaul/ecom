import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { categoriesPayloadSchema, productsPayloadSchema } from '../src/scripts/source-data.js';

const snapshot = JSON.parse(
  await readFile(new URL('../data/products.snapshot.json', import.meta.url), 'utf8'),
);
const [sample] = snapshot.products;

const omit = (object, keys) =>
  Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));

describe('productsPayloadSchema', () => {
  it('accepts the bundled snapshot in full', () => {
    const result = productsPayloadSchema.safeParse(snapshot);
    assert.equal(result.success, true, JSON.stringify(result.error?.issues.slice(0, 3)));
    assert.equal(result.data.products.length, 194);
  });

  it('treats an absent brand as null', () => {
    const result = productsPayloadSchema.safeParse({ products: [omit(sample, ['brand'])] });
    assert.equal(result.success, true);
    assert.equal(result.data.products[0].brand, null);
  });

  it('normalises the category slug to lower case', () => {
    const result = productsPayloadSchema.safeParse({ products: [{ ...sample, category: ' Beauty ' }] });
    assert.equal(result.data.products[0].category, 'beauty');
  });

  it('defaults optional collections to empty', () => {
    const bare = omit(sample, ['tags', 'images', 'reviews', 'dimensions', 'meta']);
    const result = productsPayloadSchema.safeParse({ products: [bare] });
    assert.equal(result.success, true);
    const [product] = result.data.products;
    assert.deepEqual(product.tags, []);
    assert.deepEqual(product.images, []);
    assert.deepEqual(product.reviews, []);
    assert.deepEqual(product.dimensions, { width: null, height: null, depth: null });
    assert.deepEqual(product.meta, { createdAt: null, updatedAt: null, barcode: null, qrCode: null });
  });

  for (const [name, patch] of [
    ['missing sku', { sku: undefined }],
    ['negative price', { price: -1 }],
    ['non-integer id', { id: 1.5 }],
    ['rating above 5', { rating: 5.1 }],
    ['review rating of 0', { reviews: [{ ...sample.reviews[0], rating: 0 }] }],
    ['invalid review date', { reviews: [{ ...sample.reviews[0], date: 'yesterday' }] }],
    ['missing thumbnail', { thumbnail: undefined }],
  ]) {
    it(`rejects ${name}`, () => {
      assert.equal(productsPayloadSchema.safeParse({ products: [{ ...sample, ...patch }] }).success, false);
    });
  }
});

describe('categoriesPayloadSchema', () => {
  it('keeps slug and name and drops everything else', () => {
    const result = categoriesPayloadSchema.safeParse([{ slug: 'Beauty', name: 'Beauty', url: 'https://x' }]);
    assert.deepEqual(result.data, [{ slug: 'beauty', name: 'Beauty' }]);
  });
});
