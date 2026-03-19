import express from 'express';
import { cartRouter } from './routes/CartRouter';

export const app = express();
app.use(express.json());
app.use('/cart', cartRouter);
