import { join } from 'path';

export function buildAssetPath(subfolder: string): string {
  return join(__dirname, 'public', subfolder);
}

export function buildUploadPath(filename: string): string {
  return join(__dirname, 'uploads', filename);
}

export function buildTemplatePath(name: string): string {
  return join(__dirname, 'views', `${name}.html`);
}
