import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { errors as esErrors } from '@elastic/elasticsearch';
import { NotFoundError } from '../src/lib/errors.js';
import { createProductsService } from '../src/services/products.service.js';
import { get, startApp } from './helpers/app.js';

const product = (id) => ({ id, title: `Product ${id}`, category: 'beauty' });

function fakeRepository(pageCalls) {
  const all = Array.from({ length: 45 }, (_, i) => product(i + 1));
  return {
    async findPage({ page, limit, filters }) {
      pageCalls.push({ page, limit, filters });
      const filtered =
        filters.category === undefined ? all : all.filter((p) => p.category === filters.category);
      return { items: filtered.slice((page - 1) * limit, page * limit), total: filtered.length };
    },
    async findById(id) {
      return all.find((p) => p.id === id) ?? null;
    },
  };
}

describe('HTTP API', () => {
  let app;
  const pageCalls = [];
  const searchCalls = [];
  const search = {
    async search(params) {
      searchCalls.push(params);
      if (params.query === 'boom') throw new esErrors.ConnectionError('down');
      if (params.query === 'bad-mapping') {
        throw new esErrors.ResponseError({
          statusCode: 400,
          body: { error: { type: 'search_phase_execution_exception', reason: 'internal detail' } },
          headers: {},
          warnings: [],
          meta: {},
        });
      }
      return { items: [product(7)], total: 1 };
    },
  };

  before(async () => {
    app = await startApp({
      productsService: createProductsService({
        productsRepository: fakeRepository(pageCalls),
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
    assert.deepEqual(searchCalls, [
      { query: 'mascara', filters: { category: 'beauty' }, from: 10, size: 10 },
    ]);
    assert.deepEqual(body.meta, { source: 'elasticsearch', query: 'mascara', category: 'beauty' });
    assert.deepEqual(body.pagination, { page: 2, limit: 10, total: 1, totalPages: 1 });
  });

  it('passes rating and price filters to both stores and echoes them in meta', async () => {
    pageCalls.length = 0;
    searchCalls.length = 0;
    const sql = await get(app.baseUrl, '/products?minRating=4&minPrice=10&maxPrice=99.5');
    assert.equal(sql.status, 200);
    assert.deepEqual(pageCalls.at(-1).filters, { minRating: 4, minPrice: 10, maxPrice: 99.5 });
    assert.deepEqual(sql.body.meta, { source: 'mysql', minRating: 4, minPrice: 10, maxPrice: 99.5 });

    const es = await get(app.baseUrl, '/products?query=phone&minRating=4.5');
    assert.equal(es.status, 200);
    assert.deepEqual(searchCalls.at(-1).filters, { minRating: 4.5 });
  });

  it('rejects a price range whose maximum is below its minimum', async () => {
    const { status, body } = await get(app.baseUrl, '/products?minPrice=50&maxPrice=10');
    assert.equal(status, 400);
    assert.deepEqual(
      body.error.details.map((d) => d.path),
      ['maxPrice'],
    );
  });

  it('serves the OpenAPI document and Swagger UI', async () => {
    const spec = await get(app.baseUrl, '/openapi.json');
    assert.equal(spec.status, 200);
    assert.equal(spec.body.openapi, '3.0.3');
    assert.deepEqual(spec.body.servers, [{ url: app.baseUrl, description: 'this instance' }]);
    assert.deepEqual(Object.keys(spec.body.paths), ['/health', '/categories', '/products', '/products/{id}']);
    const ui = await fetch(`${app.baseUrl}/docs/`);
    assert.equal(ui.status, 200);
    assert.match(await ui.text(), /swagger-ui/);
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

  it('does not expose Elasticsearch request errors as client errors', async () => {
    const { status, body } = await get(app.baseUrl, '/products?query=bad-mapping');
    assert.equal(status, 500);
    assert.deepEqual(body, { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  it('rejects a malformed percent-encoded path with 400', async () => {
    const { status, body } = await get(app.baseUrl, '/products/%E0%A4%A');
    assert.equal(status, 400);
    assert.equal(body.error.code, 'BAD_REQUEST');
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

describe('rate limiting', () => {
  it('answers 429 with the error envelope once the per-minute limit is exceeded', async () => {
    const app = await startApp({
      rateLimitPerMinute: 2,
      categoriesService: { list: async () => [] },
    });
    try {
      assert.equal((await get(app.baseUrl, '/categories')).status, 200);
      assert.equal((await get(app.baseUrl, '/categories')).status, 200);
      const third = await get(app.baseUrl, '/categories');
      assert.equal(third.status, 429);
      assert.deepEqual(third.body, {
        error: { code: 'RATE_LIMITED', message: 'Too many requests; retry later' },
      });
      assert.ok(third.headers.get('ratelimit'));
    } finally {
      await app.close();
    }
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
