import { chromium } from 'playwright';

// Drives Swagger UI in a real browser: lists the operations and schemas, then
// uses "Try it out" on each endpoint and checks the responses.
// Needs a running stack and Google Chrome (or set PLAYWRIGHT_CHANNEL / run
// `npx playwright install chromium`).
const base = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'chrome';
const browser = await chromium.launch({ channel, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
const checks = [];
const expect = (name, ok, extra = '') => {
  checks.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? `  (${extra})` : ''}`);
};

async function open() {
  const page = await context.newPage();
  // Chrome logs every non-2xx fetch as a console error; those are expected for the 400/404 checks.
  page.on(
    'console',
    (m) => m.type() === 'error' && !/status of 4\d\d/.test(m.text()) && consoleErrors.push(m.text()),
  );
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(`${base}/docs/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.swagger-ui .opblock', { timeout: 20000 });
  return page;
}

const first = await open();
console.log('title:', (await first.textContent('.swagger-ui .title')).trim());
const ops = await first.$$eval('.opblock-summary', (els) =>
  els.map(
    (e) =>
      `${e.querySelector('.opblock-summary-method')?.textContent} ${e.querySelector('.opblock-summary-path')?.textContent}  ${e.querySelector('.opblock-summary-description')?.textContent}`,
  ),
);
console.log('operations:\n  ' + ops.join('\n  '));
const models = await first.$$eval('.models .model-container', (els) =>
  els.map((e) => e.getAttribute('data-name')),
);
console.log('schemas:', models.join(', '));
expect('all four endpoints are listed', ops.length === 4);
expect('all eight schemas are listed', models.length === 8);
await first.close();

async function tryIt(path, params) {
  const page = await open();
  const block = page
    .locator('.opblock')
    .filter({ has: page.locator(`.opblock-summary-path[data-path="${path}"]`) })
    .first();
  await block.locator('.opblock-summary-control').click();
  await block.locator('.try-out__btn').click();
  const prefilled = await block
    .locator('.parameters input')
    .evaluateAll((inputs) => inputs.map((i) => i.value).filter(Boolean));
  for (const [name, value] of Object.entries(params)) {
    await block.locator(`[data-param-name="${name}"] input`).fill(String(value));
  }
  await block.locator('button.execute').click();
  const row = block.locator('.live-responses-table tr.response');
  await row.waitFor({ timeout: 15000 });
  const requestUrl = (await block.locator('.request-url pre').textContent()).trim();
  const status = (await row.locator('.response-col_status').textContent()).trim();
  const body = (
    await row
      .locator('.response-col_description .microlight, .response-col_description pre')
      .first()
      .textContent()
  ).trim();
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    /* not json */
  }
  console.log(
    `\n[GET ${path}] params=${JSON.stringify(params)}\n  request: ${requestUrl}\n  status: ${status}\n  body: ${body.replace(/\s+/g, ' ').slice(0, 200)}`,
  );
  await page.close();
  return { status, parsed, requestUrl, prefilled };
}

let r = await tryIt('/health', {});
expect('health 200 with checks', r.status === '200' && r.parsed?.checks?.mysql === 'up');
r = await tryIt('/categories', {});
expect('categories 200 with 24 rows', r.status === '200' && r.parsed?.data?.length === 24);
r = await tryIt('/products', {});
expect(
  'Try it out starts with empty parameters',
  r.prefilled.length === 0,
  `prefilled=${JSON.stringify(r.prefilled)}`,
);
expect(
  'plain Execute lists page 1 from mysql',
  r.status === '200' && r.requestUrl === `${base}/products` && r.parsed?.pagination?.total === 194,
);
r = await tryIt('/products', { query: 'mascra', limit: 2 });
expect('search: only the filled params are sent', r.requestUrl === `${base}/products?query=mascra&limit=2`);
expect(
  'search 200 from elasticsearch, first hit is the mascara',
  r.status === '200' && r.parsed?.meta?.source === 'elasticsearch' && r.parsed?.data?.[0]?.id === 1,
);
r = await tryIt('/products', { category: 'smartphones', minRating: 4, maxPrice: 1000, limit: 3 });
expect(
  'filtered list 200 from mysql, smartphones rated >= 4 under 1000',
  r.status === '200' &&
    r.parsed?.meta?.source === 'mysql' &&
    r.parsed?.data?.length === 3 &&
    r.parsed.data.every((p) => p.category === 'smartphones' && p.rating >= 4 && p.price <= 1000),
);
r = await tryIt('/products', { minPrice: 50, maxPrice: 10 });
expect(
  'bad price range 400 with details',
  r.status === '400' && r.parsed?.error?.details?.[0]?.path === 'maxPrice',
);
r = await tryIt('/products/{id}', { id: 1 });
expect('detail 200 with three reviews', r.status === '200' && r.parsed?.data?.reviews?.length === 3);
r = await tryIt('/products/{id}', { id: 999999 });
expect('unknown id 404', r.status === '404' && r.parsed?.error?.code === 'NOT_FOUND');
{
  const page = await open();
  const block = page
    .locator('.opblock')
    .filter({ has: page.locator('.opblock-summary-path[data-path="/products/{id}"]') })
    .first();
  await block.locator('.opblock-summary-control').click();
  await block.locator('.try-out__btn').click();
  await block.locator('[data-param-name="id"] input').fill('abc');
  await block.locator('button.execute').click();
  await page.waitForTimeout(1000);
  const invalid = await block.locator('[data-param-name="id"] input.invalid').count();
  const sent = await block.locator('.live-responses-table tr.response').count();
  console.log(
    `\n[GET /products/{id}] params={"id":"abc"}\n  Swagger UI marks the field invalid (integer expected) and does not send the request`,
  );
  expect('malformed id is rejected in the browser before any request', invalid === 1 && sent === 0);
  await page.close();
}

console.log('\nconsole errors:', consoleErrors.length ? consoleErrors : 'none');
console.log(`${checks.filter((c) => c.ok).length}/${checks.length} Swagger UI checks passed`);
await browser.close();
process.exitCode = checks.every((c) => c.ok) && consoleErrors.length === 0 ? 0 : 1;
