/**
 * Arquivos da marca (prancha 02 do kit). O markup vem de `brand-assets.ts`, gerado por
 * `scripts/brand.mjs` junto com `brand/*.svg` e `brand/png/*.png` (`pnpm brand`).
 * Web: renderize o `svg` inline. Mobile: `<SvgXml xml={brandSvg(asset)} width={…} height={…} />`.
 */
import * as assets from './brand-assets';

export type BrandAsset = (typeof assets)[keyof typeof assets];
export type BrandAssetName = BrandAsset['name'];
export type LogoLayout = 'vertical' | 'horizontal' | 'symbol';
export type LogoTone = 'positive' | 'negative' | 'on-sol' | 'mono-dark' | 'mono-white';

export const brandAssets: Record<BrandAssetName, BrandAsset> = Object.fromEntries(
  Object.values(assets).map((a) => [a.name, a]),
) as Record<BrandAssetName, BrandAsset>;

/**
 * Versões aprovadas por layout e tom. Positivo em fundos claros, negativo sobre Mar e fundos
 * escuros, "sobre Sol" no amarelo. O monocromático só existe na horizontal.
 */
export const brandLogos: Record<LogoLayout, Partial<Record<LogoTone, BrandAsset>>> = {
  vertical: {
    positive: assets.logoVertical,
    negative: assets.logoVerticalNegative,
    'on-sol': assets.logoVerticalOnSol,
  },
  horizontal: {
    positive: assets.logoHorizontal,
    negative: assets.logoHorizontalNegative,
    'on-sol': assets.logoHorizontalOnSol,
    'mono-dark': assets.logoMonoDark,
    'mono-white': assets.logoMonoWhite,
  },
  symbol: {
    positive: assets.symbol,
    negative: assets.symbolNegative,
    'on-sol': assets.symbolOnSol,
  },
};

/**
 * Largura mínima em px (prancha 02). Abaixo de 40 px use o `favicon` (sem malha e sem rastros).
 */
export const logoMinWidth: Record<LogoLayout, number> = {
  vertical: 96,
  horizontal: 160,
  symbol: 40,
};

/**
 * Área de proteção em px para a largura renderizada: x = raio da bola, na escala do arquivo.
 * Nenhum texto ou imagem entra nessa margem.
 */
export function logoClearSpace(asset: BrandAsset, renderedWidth: number = asset.width): number {
  return (asset.clearSpace * renderedWidth) / asset.width;
}

/**
 * Markup do SVG com o id do clipPath da bola único (`idSuffix`), para quando a mesma versão
 * aparece mais de uma vez na página e uma das cópias pode ficar oculta (`display: none`).
 */
export function brandSvg(asset: BrandAsset, idSuffix?: string): string {
  if (!idSuffix) return asset.svg;
  const id = `ss-clip-${asset.name}`;
  return asset.svg.replaceAll(id, `${id}-${idSuffix}`);
}

export * from './brand-assets';
