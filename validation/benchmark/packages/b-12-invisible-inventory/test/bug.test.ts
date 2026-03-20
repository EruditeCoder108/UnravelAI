import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { ProductSerializer } from '../src/serializers/ProductSerializer';
import { ProductRepository } from '../src/repositories/ProductRepository';
import { CheckoutService } from '../src/services/CheckoutService';

describe('B-12 ProductSerializer — reservedStock missing from ALLOWED_FIELDS', () => {
  it('GET /products/:id response should include reservedStock', async () => {
    const res = await request(app).get('/products/prod-1');
    expect(res.status).toBe(200);
    expect(res.body.reservedStock).toBe(12);
  });

  it('serialized product should have reservedStock field', async () => {
    const repo = new ProductRepository();
    const serializer = new ProductSerializer();
    const product = await repo.findById('prod-1');
    const serialized = serializer.serialize(product!);
    expect(serialized.reservedStock).toBe(12);
  });

  it('checkout validation should account for reserved stock', async () => {
    const res = await request(app)
      .post('/checkout/validate')
      .send({ productId: 'prod-2', quantity: 1 });

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toContain('reserved');
  });

  it('product with all stock reserved should show 0 available', async () => {
    const repo = new ProductRepository();
    const serializer = new ProductSerializer();
    const checkout = new CheckoutService();
    const product = await repo.findById('prod-2');
    const serialized = serializer.serialize(product!);
    const result = checkout.validateAvailability(serialized, 1);
    expect(result.availableStock).toBe(0);
    expect(result.available).toBe(false);
  });
});
