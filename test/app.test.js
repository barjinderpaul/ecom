import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { errors as esErrors } from '@elastic/elasticsearch';
import { NotFoundError } from '../src/lib/errors.js';
import { createProductsService } from '../src/services/products.service.js';
import { get, startApp } from './helpers/app.js';

const product = (id) => ({ id, title: `Product ${id}`, category: 'beauty' });

function fakeRepository() {
  const all = Array.from({ length: 45 }, (_, i) => product(i + 1));
  return {
    async findPage({ page, limit, category }) {
      const filtered = category === undefined ? all : all.filter((p) => p.category === category);
      return { items: filtered.slice((page - 1) * limit, page * limit), total: filtered.length };
    },
    async findById(id) {
      return all.find((p) => p.id === id) ?? null;
    },
  };
}

describe('HTTP API', () => {
  let app;
  const searchCalls = [];
  const search = {
    async search(params) {
      searchCalls.push(params);
      if (params.query === 'boom') throw new esErrors.ConnectionError('down');
      return { items: [product(7)], total: 1 };
    },
  };

  before(async () => {
    app = await startApp({
      productsService: createProductsService({
        productsRepository: fakeRepository(),
        productsSearch: search,
      }),
      categoriesService: { list: async () => [{ slug: 'beauty', name: 'Beauty', productCount: 45 }] },
    });
  });
  after(() => app.close());

  it('GET /categories lists categories', async () => {
    const { status, body } = await get(app.baseUrl, '/categories');
    assert.equal(status, 200);
    assert.deepEqual(body, { data: [{ slug: 'beauty', name: 'Beauty', productCount: 45 }] });
  });

  it('GET /products pages from MySQL with defaults', async () => {
    const { status, body } = await get(app.baseUrl, '/products');
    assert.equal(status, 200);
    assert.equal(body.data.length, 20);
    assert.deepEqual(body.pagination, { page: 1, limit: 20, total: 45, totalPages: 3 });
    assert.deepEqual(body.meta, { source: 'mysql' });
  });

  it('GET /products returns an empty page past the end', async () => {
    const { status, body } = await get(app.baseUrl, '/products?page=4');
    assert.equal(status, 200);
    assert.deepEqual(body.data, []);
    assert.deepEqual(body.pagination, { page: 4, limit: 20, total: 45, totalPages: 3 });
  });

  it('GET /products?category= filters in MySQL and echoes the normalised slug', async () => {
    const { body } = await get(app.baseUrl, '/products?category=BEAUTY&limit=5');
    assert.equal(body.data.length, 5);
    assert.deepEqual(body.meta, { source: 'mysql', category: 'beauty' });
  });

  it('GET /products?category=unknown returns an empty list, not an error', async () => {
    const { status, body } = await get(app.baseUrl, '/products?category=nope');
    assert.equal(status, 200);
    assert.deepEqual(body.data, []);
    assert.equal(body.pagination.total, 0);
    assert.equal(body.pagination.totalPages, 0);
  });

  it('GET /products?query= searches Elasticsearch with the category as a filter', async () => {
    searchCalls.length = 0;
    const { status, body } = await get(
      app.baseUrl,
      '/products?query=mascara&category=beauty&page=2&limit=10',
    );
    assert.equal(status, 200);
    assert.deepEqual(searchCalls, [{ query: 'mascara', category: 'beauty', from: 10, size: 10 }]);
    assert.deepEqual(body.meta, { source: 'elasticsearch', query: 'mascara', category: 'beauty' });
    assert.deepEqual(body.pagination, { page: 2, limit: 10, total: 1, totalPages: 1 });
  });

  it('GET /products?query= rejects pages beyond the search result window', async () => {
    const { status, body } = await get(app.baseUrl, '/products?query=x&page=101&limit=100');
    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  it('GET /products validates query parameters', async () => {
    const { status, body } = await get(app.baseUrl, '/products?page=0&limit=abc');
    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.deepEqual(
      body.error.details.map((d) => d.path),
      ['page', 'limit'],
    );
  });

  it('GET /products/:id returns the product', async () => {
    const { status, body } = await get(app.baseUrl, '/products/7');
    assert.equal(status, 200);
    assert.deepEqual(body, { data: product(7) });
  });

  it('GET /products/:id returns 404 for a missing product', async () => {
    const { status, body } = await get(app.baseUrl, '/products/999');
    assert.equal(status, 404);
    assert.deepEqual(body, { error: { code: 'NOT_FOUND', message: 'Product 999 not found' } });
  });

  it('GET /products/:id returns 400 for a malformed id', async () => {
    for (const id of ['abc', '0', '-1', '1.5', '01']) {
      const { status, body } = await get(app.baseUrl, `/products/${id}`);
      assert.equal(status, 400, id);
      assert.equal(body.error.code, 'VALIDATION_ERROR');
    }
  });

  it('maps search backend failures to 503', async () => {
    const { status, body } = await get(app.baseUrl, '/products?query=boom');
    assert.equal(status, 503);
    assert.equal(body.error.code, 'SERVICE_UNAVAILABLE');
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const { status, body } = await get(app.baseUrl, '/nope');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  it('sets security headers and hides the framework', async () => {
    const { headers } = await get(app.baseUrl, '/categories');
    assert.equal(headers.get('x-powered-by'), null);
    assert.equal(headers.get('x-content-type-options'), 'nosniff');
  });
});

describe('health endpoint', () => {
  it('returns 503 when a dependency is down', async () => {
    const app = await startApp({
      healthService: {
        check: async () => ({ status: 'degraded', checks: { mysql: 'down', elasticsearch: 'up' } }),
      },
    });
    try {
      const { status, body } = await get(app.baseUrl, '/health');
      assert.equal(status, 503);
      assert.deepEqual(body, { status: 'degraded', checks: { mysql: 'down', elasticsearch: 'up' } });
    } finally {
      await app.close();
    }
  });
});

describe('error handler', () => {
  it('reports unexpected errors as an opaque 500', async () => {
    const app = await startApp({
      categoriesService: {
        list: async () => {
          throw new Error('secret details');
        },
      },
    });
    try {
      const { status, body } = await get(app.baseUrl, '/categories');
      assert.equal(status, 500);
      assert.deepEqual(body, { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    } finally {
      await app.close();
    }
  });

  it('serialises HttpError subclasses thrown by services', async () => {
    const app = await startApp({
      categoriesService: {
        list: async () => {
          throw new NotFoundError('gone');
        },
      },
    });
    try {
      const { status, body } = await get(app.baseUrl, '/categories');
      assert.equal(status, 404);
      assert.deepEqual(body, { error: { code: 'NOT_FOUND', message: 'gone' } });
    } finally {
      await app.close();
    }
  });
});
