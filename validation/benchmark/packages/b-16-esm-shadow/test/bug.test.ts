import { describe, it, expect } from 'vitest';
import { buildAssetPath, buildUploadPath } from '../src/utils/pathUtils.js';
import { getStaticRoot, getAppRoot } from '../src/app.js';

describe('B-16 pathUtils — __dirname undefined in ESM', () => {
  it('buildAssetPath should return an absolute path, not starting with undefined', () => {
    const result = buildAssetPath('images');
    expect(result).not.toContain('undefined');
    expect(result).toMatch(/^[/\\]/);
  });

  it('buildUploadPath should return a valid path', () => {
    const result = buildUploadPath('photo.jpg');
    expect(result).not.toContain('undefined');
    expect(result).toContain('uploads');
  });

  it('getStaticRoot delegates to buildAssetPath and should be a real path', () => {
    const result = getStaticRoot();
    expect(result).not.toContain('undefined');
    expect(result).toContain('images');
  });

  it('app.ts own __dirname resolution is correct (proving partial migration)', () => {
    const appRoot = getAppRoot();
    expect(appRoot).not.toContain('undefined');
    expect(appRoot).toContain('public');
  });
});
