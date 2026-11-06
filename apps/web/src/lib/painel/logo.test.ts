import { describe, expect, it } from 'vitest';
import { LOGO_MAX_BYTES, validateLogoDimensions, validateLogoFile } from './logo';

describe('validateLogoFile', () => {
  it('aceita JPEG, PNG e WebP até 2 MB', () => {
    expect(validateLogoFile({ type: 'image/png', size: 1024 })).toBeNull();
    expect(validateLogoFile({ type: 'image/jpeg', size: LOGO_MAX_BYTES })).toBeNull();
    expect(validateLogoFile({ type: 'image/webp', size: 1 })).toBeNull();
  });

  it('recusa outros tipos, arquivo vazio e acima de 2 MB', () => {
    expect(validateLogoFile({ type: 'image/gif', size: 1024 })).toMatch(/JPEG, PNG ou WebP/);
    expect(validateLogoFile({ type: 'image/svg+xml', size: 1024 })).toMatch(/JPEG, PNG ou WebP/);
    expect(validateLogoFile({ type: 'image/png', size: 0 })).toMatch(/vazio/);
    expect(validateLogoFile({ type: 'image/png', size: LOGO_MAX_BYTES + 1 })).toMatch(/2 MB/);
  });
});

describe('validateLogoDimensions', () => {
  it('só aceita imagem quadrada', () => {
    expect(validateLogoDimensions({ width: 512, height: 512 })).toBeNull();
    expect(validateLogoDimensions({ width: 800, height: 600 })).toMatch(/quadrada.*800×600/);
  });
});
