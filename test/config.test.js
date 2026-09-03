import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults to an empty environment', () => {
    const config = loadConfig({});
    assert.equal(config.PORT, 3000);
    assert.equal(config.ELASTICSEARCH_INDEX, 'products');
    assert.equal(config.SEED_FALLBACK_TO_SNAPSHOT, true);
  });

  it('coerces and validates values', () => {
    const config = loadConfig({ PORT: '8080', SEED_FALLBACK_TO_SNAPSHOT: 'false' });
    assert.equal(config.PORT, 8080);
    assert.equal(config.SEED_FALLBACK_TO_SNAPSHOT, false);
  });

  for (const [name, env] of [
    ['a non-numeric port', { PORT: 'abc' }],
    ['an out-of-range port', { MYSQL_PORT: '70000' }],
    ['an invalid URL', { ELASTICSEARCH_URL: 'not a url' }],
    ['an upper-case index name', { ELASTICSEARCH_INDEX: 'Products' }],
    ['a non-boolean fallback flag', { SEED_FALLBACK_TO_SNAPSHOT: 'yes' }],
  ]) {
    it(`rejects ${name} with a readable message`, () => {
      assert.throws(() => loadConfig(env), /Invalid configuration: /);
    });
  }
});
