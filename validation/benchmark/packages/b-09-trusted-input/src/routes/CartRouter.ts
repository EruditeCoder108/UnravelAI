import { Router, Request, Response } from 'express';
import { DiscountService } from '../services/DiscountService';
import { CartSummary } from '../models/CartSummary';

/**
 * Handles cart operations including discount code application.
 */
export const cartRouter = Router();
const discountService = new DiscountService();

cartRouter.get('/apply-discount', (req: Request, res: Response) => {
  const { code, total, currency = 'USD', items = '1' } = req.query;

  if (!code || !total) {
    return res.status(400).json({ error: 'code and total are required' });
  }

  const cart = {
    total: total,
    currency: currency as string,
    itemCount: parseInt(items as string, 10) || 1,
  } as unknown as CartSummary;

  const result = discountService.validate(code as string, cart);
  return res.json(result);
});
