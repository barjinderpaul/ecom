import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'must be a valid date');
const nonNegative = z.number().min(0);

const toSlug = (value) =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const slug = z.string().trim().min(1).max(100).transform(toSlug).pipe(z.string().min(1).max(100));
const nonBlankStrings = (max) =>
  z
    .array(z.string().trim().max(max))
    .default([])
    .transform((values) => values.filter((value) => value.length > 0));

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000),
  date: isoDate,
  reviewerName: z.string().min(1).max(255),
  reviewerEmail: z.string().min(1).max(255),
});

const productSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(1).max(255),
  description: z.string().default(''),
  category: slug,
  price: nonNegative,
  discountPercentage: nonNegative.max(100),
  rating: nonNegative.max(5),
  stock: z.number().int().min(0),
  tags: nonBlankStrings(100),
  brand: z
    .string()
    .trim()
    .max(100)
    .nullable()
    .default(null)
    .transform((value) => value || null),
  sku: z.string().trim().min(1).max(64),
  weight: nonNegative.nullable().default(null),
  dimensions: z
    .object({
      width: nonNegative.nullable().default(null),
      height: nonNegative.nullable().default(null),
      depth: nonNegative.nullable().default(null),
    })
    .default({ width: null, height: null, depth: null }),
  warrantyInformation: z.string().trim().min(1).max(255),
  shippingInformation: z.string().trim().min(1).max(255),
  availabilityStatus: z.string().trim().min(1).max(50),
  reviews: z.array(reviewSchema).default([]),
  returnPolicy: z.string().trim().min(1).max(255),
  minimumOrderQuantity: z.number().int().min(1),
  meta: z
    .object({
      createdAt: isoDate.nullable().default(null),
      updatedAt: isoDate.nullable().default(null),
      barcode: z.string().max(64).nullable().default(null),
      qrCode: z.string().max(1024).nullable().default(null),
    })
    .default({ createdAt: null, updatedAt: null, barcode: null, qrCode: null }),
  images: nonBlankStrings(1024),
  thumbnail: z.string().trim().min(1).max(1024),
});

const categorySchema = z.object({
  slug,
  name: z.string().trim().min(1).max(100),
});

export const productsPayloadSchema = z.object({ products: z.array(productSchema) });
export const categoriesPayloadSchema = z.array(categorySchema);

const snapshotDir = new URL('../../data/', import.meta.url);

async function fetchJson(url, { attempts = 2, timeoutMs = 10_000 } = {}) {
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

function normalise(raw) {
  return {
    products: parse(productsPayloadSchema, raw.products, 'products').products,
    categories: parse(categoriesPayloadSchema, raw.categories, 'categories'),
  };
}

async function loadRemote(baseUrl) {
  const [products, categories] = await Promise.all([
    fetchJson(`${baseUrl}/products?limit=0`),
    fetchJson(`${baseUrl}/products/categories`),
  ]);
  return normalise({ products, categories });
}

async function loadSnapshot() {
  const [products, categories] = await Promise.all([
    readFile(new URL('products.snapshot.json', snapshotDir), 'utf8').then(JSON.parse),
    readFile(new URL('categories.snapshot.json', snapshotDir), 'utf8').then(JSON.parse),
  ]);
  return normalise({ products, categories });
}

/**
 * Loads and validates the catalogue from the upstream API. When the fetch
 * fails or the payload no longer matches the expected shape, and the fallback
 * is enabled, the snapshot committed in data/ is used instead.
 */
export async function loadSourceData({ baseUrl, fallbackToSnapshot, logger }) {
  try {
    return { origin: 'remote', ...(await loadRemote(baseUrl.replace(/\/+$/, ''))) };
  } catch (err) {
    if (!fallbackToSnapshot) throw err;
    logger.warn({ err: err.message, baseUrl }, 'Upstream data unusable; using bundled snapshot');
    return { origin: 'snapshot', ...(await loadSnapshot()) };
  }
}
