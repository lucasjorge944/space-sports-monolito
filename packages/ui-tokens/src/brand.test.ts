import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brandAssets, brandLogos, brandSvg, logoClearSpace, logoMinWidth } from './brand';

const brandDir = join(__dirname, '..', 'brand');

/** Largura e altura do cabeçalho IHDR de um PNG. */
function pngSize(file: string): [number, number] {
  const buf = readFileSync(join(brandDir, 'png', file));
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe('arquivos da marca', () => {
  it.each(Object.values(brandAssets))(
    'brand/$file está sincronizado com src/brand-assets.ts (rode `pnpm brand`)',
    (asset) => {
      expect(readFileSync(join(brandDir, asset.file), 'utf8')).toBe(`${asset.svg}\n`);
      expect(asset.svg).toContain(`viewBox="0 0 ${asset.width} ${asset.height}"`);
    },
  );

  it('o nome está em contorno (sem <text> nem dependência de fonte)', () => {
    for (const asset of Object.values(brandAssets)) {
      expect(asset.svg).not.toMatch(/<text|font-family/);
    }
  });

  it.each([
    ['icon.png', 1024, 1024],
    ['android-icon-foreground.png', 1024, 1024],
    ['android-icon-background.png', 1024, 1024],
    ['android-icon-monochrome.png', 1024, 1024],
    ['splash-icon.png', 1024, 1024],
    ['favicon-48.png', 48, 48],
    ['favicon-32.png', 32, 32],
    ['apple-touch-icon.png', 180, 180],
    ['og-image.png', 1200, 630],
  ])('brand/png/%s tem %ix%i', (file, w, h) => {
    expect(pngSize(file)).toEqual([w, h]);
  });
});

describe('uso da logo', () => {
  it('a área de proteção é o raio da bola na escala renderizada', () => {
    const symbol = brandLogos.symbol.positive;
    expect(symbol?.clearSpace).toBe(54);
    expect(logoClearSpace(brandAssets['logo-vertical'], 96)).toBeCloseTo((51.75 * 96) / 214);
  });

  it('nenhum arquivo é menor que o mínimo do seu layout', () => {
    expect(brandAssets['logo-vertical'].width).toBeGreaterThanOrEqual(logoMinWidth.vertical);
    expect(brandAssets['logo-horizontal'].width).toBeGreaterThanOrEqual(logoMinWidth.horizontal);
    expect(brandAssets.symbol.width).toBeGreaterThanOrEqual(logoMinWidth.symbol);
  });

  it('brandSvg troca o id do clipPath', () => {
    const svg = brandSvg(brandAssets.symbol, 'header');
    expect(svg).toContain('id="ss-clip-symbol-header"');
    expect(svg).toContain('url(#ss-clip-symbol-header)');
    expect(svg).not.toContain('id="ss-clip-symbol"');
  });
});
