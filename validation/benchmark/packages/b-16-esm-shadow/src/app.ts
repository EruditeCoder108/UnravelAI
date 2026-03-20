import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { buildAssetPath } from './utils/pathUtils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getStaticRoot(): string {
  return buildAssetPath('images');
}

export function getAppRoot(): string {
  return join(__dirname, 'public');
}

export function getUploadDir(): string {
  return join(__dirname, 'uploads');
}
