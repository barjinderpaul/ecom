import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applySchema } from '../src/db/mysql.js';

describe('applySchema', () => {
  it('executes each CREATE TABLE statement separately, without comments', async () => {
    const executed = [];
    const count = await applySchema({ query: async (sql) => executed.push(sql) });
    assert.equal(count, 6);
    assert.equal(executed.length, 6);
    for (const statement of executed) {
      assert.match(statement, /^CREATE TABLE IF NOT EXISTS \w+ \(/);
      assert.doesNotMatch(statement, /--/);
      assert.doesNotMatch(statement, /;/);
    }
    assert.deepEqual(
      executed.map((s) => s.match(/EXISTS (\w+)/)[1]),
      ['categories', 'products', 'product_images', 'tags', 'product_tags', 'product_reviews'],
    );
  });
});
