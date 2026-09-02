/**
 * The only mapper from MySQL rows to the public product shape. It is used when
 * serving from MySQL and when building Elasticsearch documents, so both stores
 * return identical representations.
 */

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIso(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toReviewDto(row) {
  return {
    rating: row.rating,
    comment: row.comment,
    date: toIso(row.reviewed_at),
    reviewerName: row.reviewer_name,
    reviewerEmail: row.reviewer_email,
  };
}

export function toProductSummary(row, { images = [], tags = [] } = {}) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category_slug,
    categoryName: row.category_name,
    brand: row.brand ?? null,
    sku: row.sku,
    price: toNumber(row.price),
    discountPercentage: toNumber(row.discount_percentage),
    rating: toNumber(row.rating),
    stock: row.stock,
    tags,
    weight: toNumber(row.weight),
    dimensions: {
      width: toNumber(row.width),
      height: toNumber(row.height),
      depth: toNumber(row.depth),
    },
    warrantyInformation: row.warranty_information,
    shippingInformation: row.shipping_information,
    availabilityStatus: row.availability_status,
    returnPolicy: row.return_policy,
    minimumOrderQuantity: row.minimum_order_quantity,
    thumbnail: row.thumbnail,
    images,
    meta: {
      barcode: row.barcode,
      qrCode: row.qr_code,
      createdAt: toIso(row.source_created_at),
      updatedAt: toIso(row.source_updated_at),
    },
  };
}

export function toProductDetail(row, { images = [], tags = [], reviews = [] } = {}) {
  return {
    ...toProductSummary(row, { images, tags }),
    reviews: reviews.map(toReviewDto),
  };
}
