// app.ts — entry point, mounts the order router

import express from 'express';
import OrderRouter from './OrderRouter';

const app = express();
app.use(express.json());
app.use('/api', OrderRouter);

app.listen(3000, () => console.log('[app] Listening on :3000'));
export default app;
