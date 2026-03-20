import { Product } from '../models/Product';

const store: Record<string, Product> = {
  'prod-1': {
    id: 'prod-1',
    name: 'Mechanical Keyboard',
    price: 149.99,
    stock: 50,
    reservedStock: 12,
    sku: 'MK-001',
    category: 'peripherals',
  },
  'prod-2': {
    id: 'prod-2',
    name: 'USB-C Hub',
    price: 39.99,
    stock: 8,
    reservedStock: 8,
    sku: 'HUB-004',
    category: 'peripherals',
  },
};

export class ProductRepository {
  async findById(id: string): Promise<Product | null> {
    await new Promise<void>((r) => setTimeout(r, 5));
    return store[id] ?? null;
  }

  async findAll(): Promise<Product[]> {
    await new Promise<void>((r) => setTimeout(r, 5));
    return Object.values(store);
  }
}
