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

describe('document shape vs mapping', () => {
  it('maps every field the DTO produces, so strict mapping cannot reject a document', async () => {
    const { toProductDetail } = await import('../src/lib/product-dto.js');
    const document = toProductDetail(
      {
        id: 1,
        title: 't',
        description: 'd',
        brand: 'b',
        sku: 's',
        price: 1,
        discount_percentage: 1,
        rating: 1,
        stock: 1,
        weight: 1,
        width: 1,
        height: 1,
        depth: 1,
        warranty_information: 'w',
        shipping_information: 's',
        availability_status: 'a',
        return_policy: 'r',
        minimum_order_quantity: 1,
        barcode: 'b',
        qr_code: 'q',
        thumbnail: 't',
        source_created_at: new Date(0),
        source_updated_at: new Date(0),
        category_slug: 'c',
        category_name: 'C',
      },
      {
        images: ['i'],
        tags: ['t'],
        reviews: [
          { rating: 5, comment: 'c', reviewed_at: new Date(0), reviewer_name: 'n', reviewer_email: 'e' },
        ],
      },
    );

    const unmapped = [];
    const walk = (value, properties, path) => {
      for (const [key, child] of Object.entries(value)) {
        const spec = properties[key];
        if (!spec) {
          unmapped.push([...path, key].join('.'));
          continue;
        }
        const sample = Array.isArray(child) ? child[0] : child;
        if (sample && typeof sample === 'object' && !(sample instanceof Date)) {
          walk(sample, spec.properties ?? {}, [...path, key]);
        }
      }
    };
    walk(document, productsIndexMappings.properties, []);
    assert.deepEqual(unmapped, []);
  });
});
