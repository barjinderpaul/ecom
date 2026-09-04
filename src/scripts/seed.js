import { config } from '../config.js';
import { applySchema, createPool, pingMysql } from '../db/mysql.js';
import { logger } from '../lib/logger.js';
import { createCatalogWriter } from '../repositories/catalog-writer.js';
import { createProductsRepository } from '../repositories/products.repository.js';
import { createSearchClient } from '../search/client.js';
import { rebuildProductsIndex } from '../search/indexer.js';
import { loadSourceData } from './source-data.js';

const WAIT_ATTEMPTS = 60;
const WAIT_DELAY_MS = 2000;

async function waitFor(name, probe) {
  for (let attempt = 1; attempt <= WAIT_ATTEMPTS; attempt += 1) {
    try {
      await probe();
      logger.info({ dependency: name, attempt }, 'Dependency is ready');
      return;
    } catch (err) {
      if (attempt === WAIT_ATTEMPTS)
        throw new Error(`${name} is not reachable: ${err.message}`, { cause: err });
      logger.info({ dependency: name, attempt, err: err.message }, 'Waiting for dependency');
      await new Promise((resolve) => setTimeout(resolve, WAIT_DELAY_MS));
    }
  }
}

function titleCase(slug) {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Approximates the utf8mb4_0900_ai_ci collation of the unique keys (case- and
 * accent-insensitive) so in-memory de-duplication agrees with MySQL.
 */
const collationKey = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function uniqueBy(items, keyOf) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assertUniqueSkus(products) {
  const bySku = new Map();
  for (const product of products) {
    const key = collationKey(product.sku);
    const existing = bySku.get(key);
    if (existing !== undefined) {
      throw new Error(`Products ${existing} and ${product.id} share SKU "${product.sku}"`);
    }
    bySku.set(key, product.id);
  }
}

function lookup(map, key, what) {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Unknown ${what} "${key}"`);
  return value;
}

async function writeCatalog(pool, { products, categories }) {
  if (products.length === 0)
    throw new Error('Source data contains no products; refusing to empty the catalogue');
  const productIds = uniqueBy(products, (p) => p.id).map((p) => p.id);
  if (productIds.length !== products.length) throw new Error('Duplicate product ids in source data');
  assertUniqueSkus(products);

  const categoryBySlug = new Map(categories.map((c) => [c.slug, c]));
  for (const product of products) {
    if (!categoryBySlug.has(product.category)) {
      categoryBySlug.set(product.category, { slug: product.category, name: titleCase(product.category) });
    }
  }
  const allCategories = [...categoryBySlug.values()];

  const productTags = new Map(products.map((p) => [p.id, uniqueBy(p.tags, collationKey)]));
  const allTags = uniqueBy([...productTags.values()].flat(), collationKey);
  const duplicateTags = products.reduce((sum, p) => sum + p.tags.length - productTags.get(p.id).length, 0);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const writer = createCatalogWriter(connection);

    const categoryIds = await writer.upsertCategories(allCategories);
    const tagIds = new Map((await writer.upsertTags(allTags)).map((row) => [collationKey(row.name), row.id]));

    await writer.upsertProducts(
      products.map((p) => ({
        id: p.id,
        categoryId: lookup(categoryIds, p.category, 'category'),
        title: p.title,
        description: p.description,
        brand: p.brand,
        sku: p.sku,
        price: p.price,
        discountPercentage: p.discountPercentage,
        rating: p.rating,
        stock: p.stock,
        weight: p.weight,
        width: p.dimensions.width,
        height: p.dimensions.height,
        depth: p.dimensions.depth,
        warrantyInformation: p.warrantyInformation,
        shippingInformation: p.shippingInformation,
        availabilityStatus: p.availabilityStatus,
        returnPolicy: p.returnPolicy,
        minimumOrderQuantity: p.minimumOrderQuantity,
        barcode: p.meta.barcode,
        qrCode: p.meta.qrCode,
        thumbnail: p.thumbnail,
        sourceCreatedAt: p.meta.createdAt ? new Date(p.meta.createdAt) : null,
        sourceUpdatedAt: p.meta.updatedAt ? new Date(p.meta.updatedAt) : null,
      })),
    );

    await writer.replaceProductImages(
      productIds,
      products.flatMap((p) => p.images.map((url, position) => ({ productId: p.id, position, url }))),
    );
    await writer.replaceProductTags(
      productIds,
      products.flatMap((p) =>
        productTags.get(p.id).map((tag, position) => ({
          productId: p.id,
          tagId: lookup(tagIds, collationKey(tag), 'tag'),
          position,
        })),
      ),
    );
    await writer.replaceProductReviews(
      productIds,
      products.flatMap((p) =>
        p.reviews.map((r, position) => ({
          productId: p.id,
          position,
          rating: r.rating,
          comment: r.comment,
          reviewerName: r.reviewerName,
          reviewerEmail: r.reviewerEmail,
          reviewedAt: new Date(r.date),
        })),
      ),
    );

    const removedProducts = await writer.deleteProductsNotIn(productIds);
    const removedTags = await writer.deleteOrphanTags();
    const removedCategories = await writer.deleteUnusedCategoriesNotIn(allCategories.map((c) => c.slug));

    await connection.commit();
    return {
      products: products.length,
      categories: allCategories.length,
      tags: allTags.length,
      deduplicated: { tags: duplicateTags },
      removed: { products: removedProducts, tags: removedTags, categories: removedCategories },
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function main() {
  const startedAt = Date.now();
  const source = await loadSourceData({
    baseUrl: config.DATA_SOURCE_URL,
    fallbackToSnapshot: config.SEED_FALLBACK_TO_SNAPSHOT,
    logger,
  });
  logger.info(
    { origin: source.origin, products: source.products.length, categories: source.categories.length },
    'Loaded source data',
  );
  logger.info(source.report, 'Source data formatted');

  const pool = createPool(config);
  const searchClient = createSearchClient(config);
  try {
    await waitFor('MySQL', () => pingMysql(pool));
    await waitFor('Elasticsearch', () =>
      searchClient.cluster.health({ wait_for_status: 'yellow', timeout: '5s' }),
    );

    const statements = await applySchema(pool);
    logger.info({ statements }, 'Schema applied');

    const written = await writeCatalog(pool, source);
    logger.info(written, 'MySQL catalogue written');

    const indexed = await rebuildProductsIndex({
      client: searchClient,
      alias: config.ELASTICSEARCH_INDEX,
      documents: createProductsRepository(pool).iterateAllDetailed(),
      logger,
    });
    logger.info(indexed, 'Elasticsearch index rebuilt');

    const durationMs = Date.now() - startedAt;
    logger.info(
      { durationMs },
      `Seed completed: ${written.products} products, ${written.categories} categories, ${written.tags} tags ` +
        `written to MySQL from ${source.origin}; ${indexed.count} documents indexed into ${indexed.index} ` +
        `in ${(durationMs / 1000).toFixed(1)}s`,
    );
  } finally {
    await Promise.allSettled([pool.end(), searchClient.close()]);
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'Seed failed');
  process.exitCode = 1;
});
