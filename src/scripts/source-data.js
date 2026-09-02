import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'must be a valid date');
const finite = z.number().finite();

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable().default(null),
  date: isoDate,
  reviewerName: z.string().min(1).max(255),
  reviewerEmail: z.string().min(1).max(255),
});

const productSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(1).max(255),
  description: z.string().default(''),
  category: z.string().trim().toLowerCase().min(1).max(100),
  price: finite.min(0),
  discountPercentage: finite.min(0).max(100).default(0),
  rating: finite.min(0).max(5).default(0),
  stock: z.number().int().min(0).default(0),
  tags: z.array(z.string().trim().min(1).max(100)).default([]),
  brand: z.string().trim().min(1).max(100).nullable().default(null),
  sku: z.string().trim().min(1).max(64),
  weight: finite.min(0).nullable().default(null),
  dimensions: z
    .object({
      width: finite.min(0).nullable().default(null),
      height: finite.min(0).nullable().default(null),
      depth: finite.min(0).nullable().default(null),
    })
    .default({ width: null, height: null, depth: null }),
  warrantyInformation: z.string().max(255).nullable().default(null),
  shippingInformation: z.string().max(255).nullable().default(null),
  availabilityStatus: z.string().max(50).default('In Stock'),
  reviews: z.array(reviewSchema).default([]),
  returnPolicy: z.string().max(255).nullable().default(null),
  minimumOrderQuantity: z.number().int().min(1).default(1),
  meta: z
    .object({
      createdAt: isoDate.nullable().default(null),
      updatedAt: isoDate.nullable().default(null),
      barcode: z.string().max(64).nullable().default(null),
      qrCode: z.string().max(1024).nullable().default(null),
    })
    .default({ createdAt: null, updatedAt: null, barcode: null, qrCode: null }),
  images: z.array(z.string().max(1024)).default([]),
  thumbnail: z.string().max(1024).nullable().default(null),
});

const categorySchema = z.object({
  slug: z.string().trim().toLowerCase().min(1).max(100),
  name: z.string().trim().min(1).max(100),
});

export const productsPayloadSchema = z.object({ products: z.array(productSchema) });
export const categoriesPayloadSchema = z.array(categorySchema);

const snapshotDir = new URL('../../data/', import.meta.url);

async function fetchJson(url, { attempts = 3, timeoutMs = 15_000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`${url} responded ${response.status}`);
      return await response.json();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw lastError;
}

function parse(schema, payload, label) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const first = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`${label} payload has an unexpected shape: ${first}`);
  }
  return result.data;
}

async function loadRemote(baseUrl) {
  const [products, categories] = await Promise.all([
    fetchJson(`${baseUrl}/products?limit=0`),
    fetchJson(`${baseUrl}/products/categories`),
  ]);
  return { products, categories };
}

async function loadSnapshot() {
  const [products, categories] = await Promise.all([
    readFile(new URL('products.snapshot.json', snapshotDir), 'utf8').then(JSON.parse),
    readFile(new URL('categories.snapshot.json', snapshotDir), 'utf8').then(JSON.parse),
  ]);
  return { products, categories };
}

/**
 * Fetches the catalogue from the upstream API, falling back to the snapshot
 * committed in data/ when the network is unavailable and the fallback is
 * enabled. Both sources are validated against the same schema.
 */
export async function loadSourceData({ baseUrl, fallbackToSnapshot, logger }) {
  let raw;
  let origin = 'remote';
  try {
    raw = await loadRemote(baseUrl.replace(/\/+$/, ''));
  } catch (err) {
    if (!fallbackToSnapshot) throw err;
    logger.warn({ err: err.message, baseUrl }, 'Upstream fetch failed; using bundled snapshot');
    raw = await loadSnapshot();
    origin = 'snapshot';
  }
  return {
    origin,
    products: parse(productsPayloadSchema, raw.products, 'products').products,
    categories: parse(categoriesPayloadSchema, raw.categories, 'categories'),
  };
}
