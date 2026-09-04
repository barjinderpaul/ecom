import pino from 'pino';
import { createApp } from '../../src/app.js';

export function startApp(overrides = {}) {
  const app = createApp({
    logger: pino({ level: 'silent' }),
    productsService: overrides.productsService ?? {},
    categoriesService: overrides.categoriesService ?? {},
    healthService: overrides.healthService ?? { check: async () => ({ status: 'ok', checks: {} }) },
    rateLimitPerMinute: overrides.rateLimitPerMinute ?? 0,
  });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

export async function get(baseUrl, path) {
  const response = await fetch(baseUrl + path);
  const body = await response.json();
  return { status: response.status, body, headers: response.headers };
}
