import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rebuildProductsIndex } from '../src/search/indexer.js';

function fakeClient({
  aliasTargets = [],
  concreteIndexOnAliasName = false,
  failBulk = false,
  failDeletePrevious = false,
  rejectFirstBulk = false,
} = {}) {
  let bulkCalls = 0;
  const calls = [];
  const client = {
    calls,
    indices: {
      create: async (params) => calls.push(['create', params.index]),
      refresh: async (params) => calls.push(['refresh', params.index]),
      existsAlias: async () => aliasTargets.length > 0,
      getAlias: async () => Object.fromEntries(aliasTargets.map((name) => [name, { aliases: {} }])),
      exists: async () => concreteIndexOnAliasName,
      updateAliases: async (params) => calls.push(['updateAliases', params.actions]),
      delete: async (params) => {
        calls.push(['delete', params.index]);
        if (failDeletePrevious && Array.isArray(params.index)) throw new Error('delete failed');
      },
    },
    bulk: async (params) => {
      calls.push(['bulk', params.operations.length / 2]);
      bulkCalls += 1;
      if (rejectFirstBulk && bulkCalls === 1) {
        return {
          errors: true,
          items: [{ index: { _id: '1', status: 429, error: { type: 'es_rejected_execution_exception' } } }],
        };
      }
      if (failBulk) {
        return {
          errors: true,
          items: [{ index: { _id: '1', error: { type: 'mapper_parsing_exception', reason: 'bad' } } }],
        };
      }
      return { errors: false, items: [] };
    },
  };
  return client;
}

async function* docs(n) {
  for (let i = 1; i <= n; i += 1) yield { id: i };
}

describe('rebuildProductsIndex', () => {
  it('creates a fresh index, loads it in batches and swaps the alias before deleting the old index', async () => {
    const client = fakeClient({ aliasTargets: ['products-1'] });
    const result = await rebuildProductsIndex({
      client,
      alias: 'products',
      documents: docs(3),
      batchSize: 2,
    });

    assert.equal(result.count, 3);
    assert.deepEqual(result.replaced, ['products-1']);
    assert.match(result.index, /^products-\d+$/);
    assert.deepEqual(
      client.calls.map(([name]) => name),
      ['create', 'bulk', 'bulk', 'refresh', 'updateAliases', 'delete'],
    );
    assert.deepEqual(client.calls[4][1], [
      { remove: { index: 'products-1', alias: 'products' } },
      { add: { index: result.index, alias: 'products' } },
    ]);
    assert.deepEqual(client.calls[5][1], ['products-1']);
  });

  it('removes a concrete index that occupies the alias name', async () => {
    const client = fakeClient({ concreteIndexOnAliasName: true });
    await rebuildProductsIndex({ client, alias: 'products', documents: docs(1) });
    assert.deepEqual(
      client.calls.map(([name]) => name),
      ['create', 'bulk', 'refresh', 'delete', 'updateAliases'],
    );
    assert.equal(client.calls[3][1], 'products');
  });

  it('deletes the new index and leaves the alias untouched when bulk loading fails', async () => {
    const client = fakeClient({ aliasTargets: ['products-1'], failBulk: true });
    await assert.rejects(
      rebuildProductsIndex({ client, alias: 'products', documents: docs(1) }),
      /Bulk indexing failed for 1 document\(s\): 1: mapper_parsing_exception bad/,
    );
    const names = client.calls.map(([name]) => name);
    assert.equal(names.includes('updateAliases'), false);
    assert.deepEqual(client.calls.at(-1), ['delete', client.calls[0][1]]);
  });

  it('retries a batch rejected under load instead of failing the run', async () => {
    const warnings = [];
    const client = fakeClient({ rejectFirstBulk: true });
    const result = await rebuildProductsIndex({
      client,
      alias: 'products',
      documents: docs(1),
      logger: { warn: (ctx, msg) => warnings.push(msg) },
    });
    assert.equal(result.count, 1);
    assert.equal(client.calls.filter(([name]) => name === 'bulk').length, 2);
    assert.equal(warnings.length, 1);
  });

  it('keeps the new index when only the old index cleanup fails', async () => {
    const warnings = [];
    const client = fakeClient({ aliasTargets: ['products-1'], failDeletePrevious: true });
    const result = await rebuildProductsIndex({
      client,
      alias: 'products',
      documents: docs(1),
      logger: { warn: (ctx, msg) => warnings.push(msg) },
    });
    assert.equal(result.count, 1);
    assert.equal(warnings.length, 1);
    assert.equal(
      client.calls.filter(([name, index]) => name === 'delete' && index === result.index).length,
      0,
    );
  });
});
