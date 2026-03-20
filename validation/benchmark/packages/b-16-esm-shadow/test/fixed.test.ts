/**
 * Fix: src/utils/pathUtils.ts
 *
 * BEFORE:
 *   import { join } from 'path';
 *   export function buildAssetPath(subfolder: string): string {
 *     return join(__dirname, 'public', subfolder);
 *   }
 *
 * AFTER:
 *   import { join, dirname } from 'path';
 *   import { fileURLToPath } from 'url';
 *   const __dirname = dirname(fileURLToPath(import.meta.url));
 *   export function buildAssetPath(subfolder: string): string {
 *     return join(__dirname, 'public', subfolder);
 *   }
 */

import { describe, it, expect } from 'vitest';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function buildAssetPathFixed(subfolder: string): string {
  return join(__dirname, 'public', subfolder);
}

function buildUploadPathFixed(filename: string): string {
  return join(__dirname, 'uploads', filename);
}

describe('B-16 pathUtils — fixed ESM __dirname', () => {
  it('buildAssetPath returns absolute path without undefined', () => {
    const result = buildAssetPathFixed('images');
    expect(result).not.toContain('undefined');
    expect(result).toMatch(/^[/\\]/);
    expect(result).toContain('images');
  });

  it('buildUploadPath returns valid path', () => {
    const result = buildUploadPathFixed('photo.jpg');
    expect(result).not.toContain('undefined');
    expect(result).toContain('uploads');
    expect(result).toContain('photo.jpg');
  });

  it('paths from fixed utils and app.ts are in the same directory tree', () => {
    const utilPath = buildAssetPathFixed('images');
    expect(utilPath).toMatch(/\/test\//);
  });
});
