import assert from 'node:assert/strict';

const baseUrl = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const results = [];

async function get(path) {
  const response = await fetch(baseUrl + path, { signal: AbortSignal.timeout(10_000) });
  const body = await response.json();
  return { status: response.status, body };
}

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}\n     ${err.message.split('\n').join('\n     ')}`);
  }
}

const isAscending = (ids) => ids.every((id, i) => i === 0 || ids[i - 1] < id);

await check('GET /health reports every dependency up', async () => {
  const { status, body } = await get('/health');
  assert.equal(status, 200);
  assert.deepEqual(body, { status: 'ok', checks: { mysql: 'up', elasticsearch: 'up' } });
});

let categories;
await check('GET /categories lists categories with product counts, sorted by name', async () => {
  const { status, body } = await get('/categories');
  assert.equal(status, 200);
  categories = body.data;
  assert.ok(categories.length > 0);
  for (const category of categories) {
    assert.match(category.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(category.name.length > 0);
    assert.ok(Number.isInteger(category.productCount) && category.productCount >= 0);
  }
  const names = categories.map((c) => c.name);
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b)),
  );
});

let total;
await check('GET /products pages through MySQL in id order', async () => {
  const first = await get('/products');
  assert.equal(first.status, 200);
  assert.equal(first.body.meta.source, 'mysql');
  total = first.body.pagination.total;
  assert.ok(total > 0);
  assert.equal(first.body.data.length, Math.min(20, total));
  assert.ok(isAscending(first.body.data.map((p) => p.id)));
  assert.equal(first.body.pagination.totalPages, Math.ceil(total / 20));

  const second = await get('/products?page=2&limit=5');
  assert.equal(second.body.pagination.page, 2);
  assert.equal(second.body.data.length, Math.min(5, Math.max(total - 5, 0)));
  const lastOnFirstPage = first.body.data.at(Math.min(4, first.body.data.length - 1)).id;
  assert.ok(second.body.data.every((p) => p.id > lastOnFirstPage));

  const beyond = await get(`/products?page=${Math.ceil(total / 20) + 1}`);
  assert.equal(beyond.status, 200);
  assert.deepEqual(beyond.body.data, []);
});

await check('GET /categories counts add up to the product total', async () => {
  assert.equal(
    categories.reduce((sum, c) => sum + c.productCount, 0),
    total,
  );
});

await check('GET /products?category= filters by slug, case-insensitively', async () => {
  const category = categories.find((c) => c.productCount > 0);
  const { status, body } = await get(`/products?category=${category.slug.toUpperCase()}&limit=100`);
  assert.equal(status, 200);
  assert.equal(body.meta.source, 'mysql');
  assert.equal(body.meta.category, category.slug);
  assert.equal(body.pagination.total, category.productCount);
  assert.ok(body.data.every((p) => p.category === category.slug));
});

await check('GET /products?category=unknown returns an empty list', async () => {
  const { status, body } = await get('/products?category=no-such-category');
  assert.equal(status, 200);
  assert.deepEqual(body.data, []);
  assert.equal(body.pagination.total, 0);
});

let detail;
await check('GET /products/:id returns the full product with relations', async () => {
  const { status, body } = await get('/products/1');
  assert.equal(status, 200);
  detail = body.data;
  assert.equal(detail.id, 1);
  assert.equal(typeof detail.price, 'number');
  assert.ok(Array.isArray(detail.tags) && Array.isArray(detail.images) && Array.isArray(detail.reviews));
  assert.ok(detail.reviews.every((r) => Number.isInteger(r.rating) && typeof r.date === 'string'));
  assert.equal(typeof detail.meta.createdAt, 'string');
});

await check('GET /products?query= returns the same product shape as MySQL', async () => {
  const { status, body } = await get(`/products?query=${encodeURIComponent(detail.title)}`);
  assert.equal(status, 200);
  assert.equal(body.meta.source, 'elasticsearch');
  assert.equal(body.meta.query, detail.title);
  const hit = body.data.find((p) => p.id === detail.id);
  assert.ok(hit, 'exact title should be found');
  assert.equal(body.data[0].id, detail.id, 'exact title should rank first');
  const summary = Object.fromEntries(Object.entries(detail).filter(([key]) => key !== 'reviews'));
  assert.deepEqual(hit, summary);
});

await check('GET /products?query= tolerates a typo', async () => {
  const word = detail.title.split(' ').find((w) => w.length >= 6) ?? detail.title;
  const typo = word.slice(0, 2) + word.slice(3);
  const { status, body } = await get(`/products?query=${encodeURIComponent(typo)}`);
  assert.equal(status, 200);
  assert.ok(
    body.data.some((p) => p.id === detail.id),
    `"${typo}" should still match product ${detail.id}`,
  );
});

await check('GET /products?query=&category= combines search with a category filter', async () => {
  const { status, body } = await get(
    `/products?query=${encodeURIComponent(detail.title)}&category=${detail.category}`,
  );
  assert.equal(status, 200);
  assert.equal(body.meta.source, 'elasticsearch');
  assert.ok(body.data.length > 0);
  assert.ok(body.data.every((p) => p.category === detail.category));
});

await check('validation and not-found responses use the error envelope', async () => {
  for (const [path, status, code] of [
    ['/products/abc', 400, 'VALIDATION_ERROR'],
    ['/products/0', 400, 'VALIDATION_ERROR'],
    ['/products/4294967295', 404, 'NOT_FOUND'],
    ['/products?page=0', 400, 'VALIDATION_ERROR'],
    ['/products?limit=101', 400, 'VALIDATION_ERROR'],
    ['/products?category=bad%20slug', 400, 'VALIDATION_ERROR'],
    ['/products?query=x&page=101&limit=100', 400, 'VALIDATION_ERROR'],
    ['/nope', 404, 'NOT_FOUND'],
  ]) {
    const { status: actual, body } = await get(path);
    assert.equal(actual, status, path);
    assert.equal(body.error.code, code, path);
  }
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed against ${baseUrl}`);
process.exitCode = failed === 0 ? 0 : 1;
