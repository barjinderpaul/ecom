import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toProductDetail, toProductSummary } from '../src/lib/product-dto.js';

const row = {
  id: 1,
  title: 'Essence Mascara Lash Princess',
  description: 'A mascara.',
  brand: 'Essence',
  sku: 'BEA-ESS-ESS-001',
  price: '9.99',
  discount_percentage: 10.48,
  rating: 2.56,
  stock: 99,
  weight: 4,
  width: 15.14,
  height: 13.08,
  depth: 22.99,
  warranty_information: '1 week warranty',
  shipping_information: 'Ships in 3-5 business days',
  availability_status: 'In Stock',
  return_policy: 'No return policy',
  minimum_order_quantity: 48,
  barcode: '5784719087687',
  qr_code: 'https://cdn.dummyjson.com/public/qr-code.png',
  thumbnail: 'https://cdn.dummyjson.com/thumb.webp',
  source_created_at: new Date('2025-04-30T09:41:02.053Z'),
  source_updated_at: '2025-04-30T09:41:02.053Z',
  category_slug: 'beauty',
  category_name: 'Beauty',
};

describe('toProductSummary', () => {
  it('maps snake_case columns to the public camelCase shape', () => {
    const dto = toProductSummary(row, { images: ['a.webp'], tags: ['beauty', 'mascara'] });
    assert.deepEqual(dto, {
      id: 1,
      title: 'Essence Mascara Lash Princess',
      description: 'A mascara.',
      category: 'beauty',
      categoryName: 'Beauty',
      brand: 'Essence',
      sku: 'BEA-ESS-ESS-001',
      price: 9.99,
      discountPercentage: 10.48,
      rating: 2.56,
      stock: 99,
      tags: ['beauty', 'mascara'],
      weight: 4,
      dimensions: { width: 15.14, height: 13.08, depth: 22.99 },
      warrantyInformation: '1 week warranty',
      shippingInformation: 'Ships in 3-5 business days',
      availabilityStatus: 'In Stock',
      returnPolicy: 'No return policy',
      minimumOrderQuantity: 48,
      thumbnail: 'https://cdn.dummyjson.com/thumb.webp',
      images: ['a.webp'],
      meta: {
        barcode: '5784719087687',
        qrCode: 'https://cdn.dummyjson.com/public/qr-code.png',
        createdAt: '2025-04-30T09:41:02.053Z',
        updatedAt: '2025-04-30T09:41:02.053Z',
      },
    });
  });

  it('converts DECIMAL strings to numbers and keeps nulls as null', () => {
    const dto = toProductSummary({ ...row, price: '36999.99', brand: null, weight: null, width: null });
    assert.equal(dto.price, 36999.99);
    assert.equal(dto.brand, null);
    assert.equal(dto.weight, null);
    assert.equal(dto.dimensions.width, null);
  });

  it('defaults relations to empty arrays', () => {
    const dto = toProductSummary(row);
    assert.deepEqual(dto.images, []);
    assert.deepEqual(dto.tags, []);
  });

  it('never exposes reviews on the summary shape', () => {
    assert.equal('reviews' in toProductSummary(row), false);
  });
});

describe('toProductDetail', () => {
  it('appends mapped reviews to the summary', () => {
    const dto = toProductDetail(row, {
      reviews: [
        {
          rating: 5,
          comment: 'Great',
          reviewed_at: new Date('2025-04-30T09:41:02.053Z'),
          reviewer_name: 'Eleanor Collins',
          reviewer_email: 'eleanor.collins@x.dummyjson.com',
        },
      ],
    });
    assert.deepEqual(dto.reviews, [
      {
        rating: 5,
        comment: 'Great',
        date: '2025-04-30T09:41:02.053Z',
        reviewerName: 'Eleanor Collins',
        reviewerEmail: 'eleanor.collins@x.dummyjson.com',
      },
    ]);
  });
});
