import express from 'express';
import { ProductRepository } from './repositories/ProductRepository';
import { ProductSerializer } from './serializers/ProductSerializer';
import { CheckoutService } from './services/CheckoutService';

export const app = express();
app.use(express.json());

const repo = new ProductRepository();
const serializer = new ProductSerializer();
const checkout = new CheckoutService();

app.get('/products/:id', async (req, res) => {
  const product = await repo.findById(req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });
  return res.json(serializer.serialize(product));
});

app.post('/checkout/validate', async (req, res) => {
  const { productId, quantity } = req.body as { productId: string; quantity: number };
  const product = await repo.findById(productId);
  if (!product) return res.status(404).json({ error: 'Not found' });
  const serialized = serializer.serialize(product);
  const result = checkout.validateAvailability(serialized, quantity);
  return res.json(result);
});
