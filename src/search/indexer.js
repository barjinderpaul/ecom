import { productsIndexMappings, productsIndexSettings } from './products-index.js';

/**
 * Builds a brand-new index, bulk-loads every document into it, then atomically
 * repoints the alias and drops whatever the alias pointed at before. Readers
 * never see a partially built index and a failed rebuild leaves the previous
 * one serving.
 */
export async function rebuildProductsIndex({ client, alias, documents, batchSize = 500, logger }) {
  const index = `${alias}-${Date.now()}`;
  await client.indices.create({ index, settings: productsIndexSettings, mappings: productsIndexMappings });

  let swapped = false;
  try {
    const count = await bulkLoad({ client, index, documents, batchSize });
    await client.indices.refresh({ index });
    const replaced = await swapAlias({ client, alias, index, logger });
    swapped = true;
    await deletePrevious({ client, indices: replaced, logger });
    return { index, count, replaced };
  } catch (err) {
    if (!swapped) await discard({ client, index, logger });
    throw err;
  }
}

async function discard({ client, index, logger }) {
  try {
    await client.indices.delete({ index }, { ignore: [404] });
  } catch (err) {
    logger?.warn({ err, index }, 'Half-built index could not be deleted');
  }
}

async function deletePrevious({ client, indices, logger }) {
  if (indices.length === 0) return;
  try {
    await client.indices.delete({ index: indices }, { ignore: [404] });
  } catch (err) {
    logger?.warn(
      { err, indices },
      'Previous index could not be deleted; the alias already points at the new one',
    );
  }
}

async function bulkLoad({ client, index, documents, batchSize }) {
  let count = 0;
  let batch = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const operations = batch.flatMap((doc) => [{ index: { _index: index, _id: String(doc.id) } }, doc]);
    const response = await client.bulk({ operations, refresh: false });
    if (response.errors) {
      const failures = response.items
        .filter((item) => item.index?.error)
        .map((item) => `${item.index._id}: ${item.index.error.type} ${item.index.error.reason ?? ''}`.trim());
      throw new Error(
        `Bulk indexing failed for ${failures.length} document(s): ${failures.slice(0, 5).join('; ')}`,
      );
    }
    count += batch.length;
    batch = [];
  };

  for await (const doc of documents) {
    batch.push(doc);
    if (batch.length >= batchSize) await flush();
  }
  await flush();
  return count;
}

async function swapAlias({ client, alias, index, logger }) {
  const actions = [];
  let previous = [];

  if (await client.indices.existsAlias({ name: alias })) {
    previous = Object.keys(await client.indices.getAlias({ name: alias }));
    actions.push(...previous.map((name) => ({ remove: { index: name, alias } })));
  } else if (await client.indices.exists({ index: alias })) {
    // A concrete index is squatting on the alias name; it cannot coexist with the alias.
    logger?.warn({ index: alias }, 'Deleting concrete index that occupies the alias name');
    await client.indices.delete({ index: alias });
  }

  actions.push({ add: { index, alias } });
  await client.indices.updateAliases({ actions });
  return previous;
}
