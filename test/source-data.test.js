import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { categoriesPayloadSchema, normalise, productsPayloadSchema } from '../src/scripts/source-data.js';

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

  it('normalises the category into a slug', () => {
    for (const [input, expected] of [
      [' Beauty ', 'beauty'],
      ['Home Décor & More', 'home-decor-more'],
      ['mens-shoes', 'mens-shoes'],
    ]) {
      const result = productsPayloadSchema.safeParse({ products: [{ ...sample, category: input }] });
      assert.equal(result.data.products[0].category, expected);
    }
  });

  it('drops blank tags and images and turns an empty brand into null', () => {
    const result = productsPayloadSchema.safeParse({
      products: [{ ...sample, tags: [' ', 'new', ''], images: ['', 'https://x/1.webp'], brand: '  ' }],
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.data.products[0].tags, ['new']);
    assert.deepEqual(result.data.products[0].images, ['https://x/1.webp']);
    assert.equal(result.data.products[0].brand, null);
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
    ['category with no slug characters', { category: '!!!' }],
  ]) {
    it(`rejects ${name}`, () => {
      assert.equal(productsPayloadSchema.safeParse({ products: [{ ...sample, ...patch }] }).success, false);
    });
  }
});

describe('normalise', () => {
  const run = (patch) =>
    normalise({
      products: { products: [{ ...sample, ...patch }] },
      categories: [{ slug: 'beauty', name: 'Beauty' }],
    });

  it('collapses whitespace, strips control characters and NFC-normalises text', () => {
    const { products, report } = run({
      title: '  Essence\u0007  Mascara\tLash  Princess ',
      brand: 'Esse\u0301nce',
    });
    assert.equal(products[0].title, 'Essence Mascara Lash Princess');
    assert.equal(products[0].brand, 'Esse\u0301nce'.normalize('NFC'));
    assert.deepEqual(report, { truncated: {}, dropped: {}, deduplicated: {} });
  });

  it('keeps paragraph breaks in descriptions but tidies the rest', () => {
    const { products } = run({ description: 'Line one.  \r\n\r\n\r\n  Line two.\t' });
    assert.equal(products[0].description, 'Line one.\n\nLine two.');
  });

  it('truncates over-long text to the column limit and reports it', () => {
    const { products, report } = run({
      title: 'x'.repeat(300),
      reviews: [{ ...sample.reviews[0], comment: 'y'.repeat(1500) }],
    });
    assert.equal(products[0].title.length, 255);
    assert.equal(products[0].reviews[0].comment.length, 1000);
    assert.deepEqual(report.truncated, { title: 1, 'reviews.comment': 1 });
  });

  it('never truncates identifiers', () => {
    assert.throws(() => run({ sku: 's'.repeat(65) }), /sku/);
  });

  it('drops duplicate and over-long image URLs and reports them', () => {
    const { products, report } = run({
      images: ['https://x/1.webp', 'https://x/1.webp ', 'https://x/' + 'a'.repeat(1100)],
    });
    assert.deepEqual(products[0].images, ['https://x/1.webp']);
    assert.deepEqual(report.deduplicated, { images: 1 });
    assert.deepEqual(report.dropped, { images: 1 });
  });

  it('lower-cases reviewer e-mail addresses', () => {
    const { products } = run({
      reviews: [{ ...sample.reviews[0], reviewerEmail: ' Eleanor.Collins@X.dummyjson.com ' }],
    });
    assert.equal(products[0].reviews[0].reviewerEmail, 'eleanor.collins@x.dummyjson.com');
  });

  it('reports nothing for the bundled snapshot', () => {
    const { report } = normalise({ products: snapshot, categories: [] });
    assert.deepEqual(report, { truncated: {}, dropped: {}, deduplicated: {} });
  });
});

describe('categoriesPayloadSchema', () => {
  it('keeps slug and name and drops everything else', () => {
    const result = categoriesPayloadSchema.safeParse([{ slug: 'Beauty', name: 'Beauty', url: 'https://x' }]);
    assert.deepEqual(result.data, [{ slug: 'beauty', name: 'Beauty' }]);
  });
});
