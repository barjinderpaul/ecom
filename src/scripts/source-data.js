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

/** Single-line text: Unicode NFC, whitespace collapsed, remaining control characters removed. */
const singleLine = (value) =>
  value
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/\p{Cc}/gu, '')
    .trim();

/** Multi-line text: as above but paragraph breaks are kept. */
const multiLine = (value) =>
  value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/(?!\n)\p{Cc}/gu, '')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const LIMITS = {
  title: 255,
  brand: 100,
  description: 20_000,
  warrantyInformation: 255,
  shippingInformation: 255,
  availabilityStatus: 50,
  returnPolicy: 255,
  tag: 100,
  url: 1024,
  reviewComment: 1000,
  reviewerName: 255,
  reviewerEmail: 255,
};

export function createReport() {
  return { truncated: {}, dropped: {}, deduplicated: {} };
}

const bump = (bucket, key) => {
  bucket[key] = (bucket[key] ?? 0) + 1;
};

/**
 * Formats free text before validation so that MySQL column limits are met by
 * truncation rather than by rejecting the whole payload, and so that the same
 * product never carries the same image twice. Identity fields (id, sku,
 * barcode) are never altered: a truncated identifier is a wrong identifier.
 * Non-string values are left for zod to reject.
 */
function clip(value, max, field, report) {
  if (typeof value !== 'string' || value.length <= max) return value;
  bump(report.truncated, field);
  return value.slice(0, max).trimEnd();
}

function text(value, max, field, report, format = singleLine) {
  return typeof value === 'string' ? clip(format(value), max, field, report) : value;
}

function formatProduct(raw, report) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const product = { ...raw };
  product.title = text(product.title, LIMITS.title, 'title', report);
  product.brand = text(product.brand, LIMITS.brand, 'brand', report);
  product.description = text(product.description, LIMITS.description, 'description', report, multiLine);
  for (const field of ['warrantyInformation', 'shippingInformation', 'availabilityStatus', 'returnPolicy']) {
    product[field] = text(product[field], LIMITS[field], field, report);
  }
  if (Array.isArray(product.tags)) {
    product.tags = product.tags.map((tag) => text(tag, LIMITS.tag, 'tags', report));
  }
  if (Array.isArray(product.images)) {
    const seen = new Set();
    product.images = product.images.filter((url) => {
      if (typeof url !== 'string') return true;
      if (url.trim().length > LIMITS.url) {
        bump(report.dropped, 'images');
        return false;
      }
      if (seen.has(url.trim())) {
        bump(report.deduplicated, 'images');
        return false;
      }
      seen.add(url.trim());
      return true;
    });
  }
  if (Array.isArray(product.reviews)) {
    product.reviews = product.reviews.map((review) => {
      if (!review || typeof review !== 'object') return review;
      return {
        ...review,
        comment: text(review.comment, LIMITS.reviewComment, 'reviews.comment', report, multiLine),
        reviewerName: text(review.reviewerName, LIMITS.reviewerName, 'reviews.reviewerName', report),
        reviewerEmail:
          typeof review.reviewerEmail === 'string'
            ? clip(
                singleLine(review.reviewerEmail).toLowerCase(),
                LIMITS.reviewerEmail,
                'reviews.reviewerEmail',
                report,
              )
            : review.reviewerEmail,
      };
    });
  }
  if (product.meta && typeof product.meta === 'object' && typeof product.meta.qrCode === 'string') {
    if (product.meta.qrCode.trim().length > LIMITS.url) {
      bump(report.dropped, 'meta.qrCode');
      product.meta = { ...product.meta, qrCode: null };
    }
  }
  return product;
}
const nonBlankStrings = (max) =>
  z
    .array(z.string().trim().max(max))
    .default([])
    .transform((values) => values.filter((value) => value.length > 0));

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(LIMITS.reviewComment),
  date: isoDate,
  reviewerName: z.string().min(1).max(LIMITS.reviewerName),
  reviewerEmail: z.string().min(1).max(LIMITS.reviewerEmail),
});

const productSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(1).max(LIMITS.title),
  description: z.string().max(LIMITS.description).default(''),
  category: slug,
  price: nonNegative,
  discountPercentage: nonNegative.max(100),
  rating: nonNegative.max(5),
  stock: z.number().int().min(0),
  tags: nonBlankStrings(LIMITS.tag),
  brand: z
    .string()
    .trim()
    .max(LIMITS.brand)
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
  warrantyInformation: z.string().trim().min(1).max(LIMITS.warrantyInformation),
  shippingInformation: z.string().trim().min(1).max(LIMITS.shippingInformation),
  availabilityStatus: z.string().trim().min(1).max(LIMITS.availabilityStatus),
  reviews: z.array(reviewSchema).default([]),
  returnPolicy: z.string().trim().min(1).max(LIMITS.returnPolicy),
  minimumOrderQuantity: z.number().int().min(1),
  meta: z
    .object({
      createdAt: isoDate.nullable().default(null),
      updatedAt: isoDate.nullable().default(null),
      barcode: z.string().max(64).nullable().default(null),
      qrCode: z.string().max(LIMITS.url).nullable().default(null),
    })
    .default({ createdAt: null, updatedAt: null, barcode: null, qrCode: null }),
  images: nonBlankStrings(LIMITS.url),
  thumbnail: z.string().trim().min(1).max(LIMITS.url),
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

/** Formats then validates a raw payload pair. Exported for tests. */
export function normalise(raw) {
  const report = createReport();
  const products = Array.isArray(raw.products?.products)
    ? { ...raw.products, products: raw.products.products.map((product) => formatProduct(product, report)) }
    : raw.products;
  return {
    products: parse(productsPayloadSchema, products, 'products').products,
    categories: parse(categoriesPayloadSchema, raw.categories, 'categories'),
    report,
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
 * Loads, formats and validates the catalogue from the upstream API. When the
 * fetch fails or the payload no longer matches the expected shape, and the
 * fallback is enabled, the snapshot committed in data/ is used instead.
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
