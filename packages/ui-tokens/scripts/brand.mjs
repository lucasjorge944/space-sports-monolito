// Gera os arquivos da marca (brand/*.svg, brand/png/*.png e src/brand-assets.ts) a partir da
// prancha 02 do kit (docs/brand/kit/02-kit-de-logos.html), que é a fonte de verdade da logo.
// Rode com `pnpm brand`. O símbolo é copiado do HTML do kit sem alterar os paths; o nome vira
// contorno com a Space Grotesk de @expo-google-fonts/space-grotesk (OFL), sem depender da fonte
// instalada. O layout do nome reproduz as regras CSS da prancha (tamanhos, entrelinha, espaçamento,
// gaps e skewX(-9deg)), com as métricas arredondadas como o Chromium faz.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import opentype from 'opentype.js';

const require = createRequire(import.meta.url);
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = join(pkgDir, '..', '..');
const brandDir = join(pkgDir, 'brand');
const pngDir = join(brandDir, 'png');
const kitHtml = readFileSync(join(repoDir, 'docs/brand/kit/02-kit-de-logos.html'), 'utf8');

const MAR = '#03547D';
const SOL = '#FBBD10';
const NOITE = '#06202E';
const REDE = '#FFFFFF';

// ---------------------------------------------------------------------------------------------
// Símbolo: markup interno dos <svg> da prancha, por rótulo (aria-label do SVG ou do lockup).

/** Bola do símbolo (viewBox 0 0 240 200): centro e raio. A área de proteção x é o raio. */
const BALL = { cx: 120, cy: 104, r: 54 };

function kitSvgs() {
  const map = new Map();
  for (const m of kitHtml.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g)) {
    const own = /aria-label="([^"]+)"/.exec(m[1])?.[1];
    const before = kitHtml.slice(0, m.index);
    const label = own ?? [...before.matchAll(/aria-label="([^"]+)"/g)].at(-1)?.[1];
    const viewBox = /viewBox="([^"]+)"/.exec(m[1])[1];
    if (label && !map.has(label)) map.set(label, { viewBox, inner: m[2] });
  }
  return map;
}

const svgs = kitSvgs();
function kitSymbol(label) {
  const svg = svgs.get(label);
  if (!svg) throw new Error(`SVG "${label}" não encontrado na prancha 02`);
  // O id do clipPath (kA, kB…) vira um marcador, trocado por um id único por arquivo.
  const id = /<clipPath id="([^"]+)"/.exec(svg.inner)?.[1];
  const inner = id
    ? svg.inner
        .replaceAll(`id="${id}"`, 'id="__CLIP__"')
        .replaceAll(`url(#${id})`, 'url(#__CLIP__)')
    : svg.inner;
  return { ...svg, inner };
}

const symbols = {
  positive: kitSymbol('Símbolo Space Sports'),
  negative: kitSymbol('Logo principal negativo'),
  onSol: kitSymbol('Logo principal sobre amarelo'),
  monoDark: kitSymbol('Logo monocromático escuro'),
  monoWhite: kitSymbol('Logo monocromático branco'),
  appMar: kitSymbol('Ícone de app azul'),
  appSol: kitSymbol('Ícone de app amarelo'),
  favicon: kitSymbol('Favicon 32 px'),
};
if (symbols.positive.inner !== kitSymbol('Logo principal positivo').inner) {
  throw new Error('O símbolo do card "Símbolo" difere do lockup positivo na prancha 02');
}

// ---------------------------------------------------------------------------------------------
// Nome em contorno.

const fontDir = dirname(require.resolve('@expo-google-fonts/space-grotesk/package.json'));
const loadFont = (file) => opentype.parse(readFileSync(join(fontDir, file)).buffer);
const fonts = {
  700: loadFont('700Bold/SpaceGrotesk_700Bold.ttf'),
  600: loadFont('600SemiBold/SpaceGrotesk_600SemiBold.ttf'),
};

const SKEW = Math.tan((9 * Math.PI) / 180);
const n = (v) => +v.toFixed(2);

/** Linha de texto com `letter-spacing` do CSS (somado depois de cada letra, inclusive a última). */
function textRun(text, { weight, size, letterSpacing = 0 }) {
  const font = fonts[weight];
  const scale = size / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(text);
  let width = 0;
  const placed = glyphs.map((g, i) => {
    const x = width;
    width += g.advanceWidth * scale + letterSpacing;
    if (i < glyphs.length - 1) width += font.getKerningValue(g, glyphs[i + 1]) * scale;
    return { g, x };
  });
  return { font, size, width, placed };
}

/** Linha de base dentro da caixa de linha, como o Chromium (métricas inteiras, floor da meia-entrelinha). */
function baselineIn(run, lineHeight) {
  const asc = Math.round((run.font.tables.hhea.ascender / run.font.unitsPerEm) * run.size);
  const desc = Math.round((-run.font.tables.hhea.descender / run.font.unitsPerEm) * run.size);
  return asc + Math.floor((lineHeight - asc - desc) / 2);
}

/** Path SVG da linha, com o skewX(-9deg) em torno de (cx, cy) aplicado aos pontos. */
function runPath(run, x, baseline, skewCenter) {
  const t = ([px, py]) => [px - SKEW * (py - skewCenter.y), py];
  let d = '';
  for (const { g, x: gx } of run.placed) {
    for (const c of g.getPath(x + gx, baseline, run.size).commands) {
      const pts = [];
      if (c.type === 'C') pts.push([c.x1, c.y1], [c.x2, c.y2]);
      if (c.type === 'Q') pts.push([c.x1, c.y1]);
      if (c.type !== 'Z') pts.push([c.x, c.y]);
      d += c.type + pts.map((p) => t(p).map(n).join(' ')).join(' ');
    }
  }
  return d;
}

/** Traço arredondado 20×2 ao lado de "SPORTS" (inclinado junto com o nome). */
function dashPath(x, y, w, h, skewCenter) {
  const r = h / 2;
  const dx = -SKEW * (y + r - skewCenter.y);
  return `M${n(x + r + dx)} ${n(y)}H${n(x + w - r + dx)}A${r} ${r} 0 0 1 ${n(x + w - r + dx)} ${n(y + h)}H${n(x + r + dx)}A${r} ${r} 0 0 1 ${n(x + r + dx)} ${n(y)}Z`;
}

// ---------------------------------------------------------------------------------------------
// Lockups (coordenadas em px CSS da prancha 02).

/**
 * Vertical (cards "Principal"): símbolo 230×191, gap 4; nome em coluna centrada com gap 3:
 * "SPACE" 40px/0.9 700 -0.01em; linha com traço 20×2, gap 6, "SPORTS" 14px/1 600 0.3em
 * (margin-right -0.3em), gap 6, traço.
 */
function verticalLockup(colors) {
  const symbolW = 230;
  const symbolH = 191;
  const space = textRun('SPACE', { weight: 700, size: 40, letterSpacing: -0.4 });
  const sports = textRun('SPORTS', { weight: 600, size: 14, letterSpacing: 4.2 });
  const cx = symbolW / 2;
  const top = symbolH + 4;
  const spaceLine = 40 * 0.9;
  const rowTop = top + spaceLine + 3;
  const rowW = 20 + 6 + (sports.width - 4.2) + 6 + 20;
  const blockH = spaceLine + 3 + 14;
  const center = { x: cx, y: top + blockH / 2 };
  const rowX = cx - rowW / 2;
  const parts = [
    `<path fill="${colors.space}" d="${runPath(space, cx - space.width / 2, top + baselineIn(space, spaceLine), center)}"/>`,
    `<path fill="${colors.sports}" d="${runPath(sports, rowX + 26, rowTop + baselineIn(sports, 14), center)}"/>`,
    `<path fill="${colors.dash}" d="${dashPath(rowX, rowTop + 6, 20, 2, center)}${dashPath(rowX + rowW - 20, rowTop + 6, 20, 2, center)}"/>`,
  ];
  return { symbolScale: symbolW / 240, symbolAt: [0, 0], text: parts.join('') };
}

/**
 * Horizontal (card "Horizontal"): símbolo 190×158, gap 4; coluna alinhada ao centro do símbolo:
 * "SPACE" 52px/0.9 700; "SPORTS" 20px/1.4 600 0.42em.
 */
function horizontalLockup(colors) {
  const symbolW = 190;
  const symbolH = 158;
  const space = textRun('SPACE', { weight: 700, size: 52 });
  const sports = textRun('SPORTS', { weight: 600, size: 20, letterSpacing: 8.4 });
  const spaceLine = 52 * 0.9;
  const sportsLine = 20 * 1.4;
  const blockW = Math.max(space.width, sports.width);
  const blockH = spaceLine + sportsLine;
  const left = symbolW + 4;
  const top = symbolH / 2 - blockH / 2;
  const center = { x: left + blockW / 2, y: top + blockH / 2 };
  const parts = [
    `<path fill="${colors.space}" d="${runPath(space, left, top + baselineIn(space, spaceLine), center)}"/>`,
    `<path fill="${colors.sports}" d="${runPath(sports, left, top + spaceLine + baselineIn(sports, sportsLine), center)}"/>`,
  ];
  return { symbolScale: symbolW / 240, symbolAt: [0, 0], text: parts.join('') };
}

// ---------------------------------------------------------------------------------------------
// Composição, recorte pela tinta e saída.

const symbolGroup = (symbol, [x, y], scale, clipId) =>
  `<g transform="translate(${n(x)} ${n(y)}) scale(${+scale.toFixed(6)})">${symbol.inner.replaceAll('__CLIP__', clipId)}</g>`;

const svgDoc = (viewBox, width, height, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}" role="img" aria-label="Space Sports">${body}</svg>`;

/** Caixa da tinta (pixels não transparentes), em unidades do SVG. */
function inkBox(body, w, h, zoom = 8) {
  const img = new Resvg(svgDoc(`0 0 ${w} ${h}`, w, h, body), {
    fitTo: { mode: 'zoom', value: zoom },
  }).render();
  const { width, height, pixels } = img;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { x: x0 / zoom, y: y0 / zoom, w: (x1 + 1 - x0) / zoom, h: (y1 + 1 - y0) / zoom };
}

/** Recorta o desenho na tinta (arredondado para fora, em px inteiros) e desloca para a origem. */
function cropped(body, canvasW, canvasH) {
  const box = inkBox(body, canvasW, canvasH);
  const x = Math.floor(box.x);
  const y = Math.floor(box.y);
  const w = Math.ceil(box.x + box.w) - x;
  const h = Math.ceil(box.y + box.h) - y;
  return { width: w, height: h, body: `<g transform="translate(${-x} ${-y})">${body}</g>` };
}

const assets = {};

function addAsset(name, { width, height, body, clearSpace, description }) {
  const svg = svgDoc(`0 0 ${width} ${height}`, width, height, body);
  assets[name] = { file: `${name}.svg`, width, height, clearSpace, description, svg };
}

const toneColors = {
  positive: { symbol: symbols.positive, space: MAR, sports: MAR, dash: SOL },
  negative: { symbol: symbols.negative, space: REDE, sports: SOL, dash: SOL },
  'on-sol': { symbol: symbols.onSol, space: MAR, sports: MAR, dash: REDE },
  'mono-dark': { symbol: symbols.monoDark, space: NOITE, sports: NOITE, dash: NOITE },
  'mono-white': { symbol: symbols.monoWhite, space: REDE, sports: REDE, dash: REDE },
};
const toneLabel = {
  positive: 'positivo (fundos claros)',
  negative: 'negativo (sobre Mar e fundos escuros)',
  'on-sol': 'sobre Sol',
  'mono-dark': 'monocromático escuro',
  'mono-white': 'monocromático branco',
};
const suffix = (tone) => (tone === 'positive' ? '' : `-${tone}`);

for (const tone of ['positive', 'negative', 'on-sol']) {
  const c = toneColors[tone];
  const v = verticalLockup(c);
  const name = `logo-vertical${suffix(tone)}`;
  const body = symbolGroup(c.symbol, v.symbolAt, v.symbolScale, `ss-clip-${name}`) + v.text;
  addAsset(name, {
    ...cropped(body, 260, 260),
    clearSpace: n(BALL.r * v.symbolScale),
    description: `Logo vertical, ${toneLabel[tone]}`,
  });
}

for (const tone of ['positive', 'negative', 'on-sol', 'mono-dark', 'mono-white']) {
  const c = toneColors[tone];
  const h = horizontalLockup(c);
  const name = tone.startsWith('mono') ? `logo-${tone}` : `logo-horizontal${suffix(tone)}`;
  const body = symbolGroup(c.symbol, h.symbolAt, h.symbolScale, `ss-clip-${name}`) + h.text;
  addAsset(name, {
    ...cropped(body, 400, 200),
    clearSpace: n(BALL.r * h.symbolScale),
    description: `Logo horizontal, ${toneLabel[tone]}`,
  });
}

for (const tone of ['positive', 'negative', 'on-sol']) {
  const name = `symbol${suffix(tone)}`;
  const body = symbolGroup(toneColors[tone].symbol, [0, 0], 1, `ss-clip-${name}`);
  addAsset(name, {
    ...cropped(body, 240, 200),
    clearSpace: BALL.r,
    description: `Símbolo, ${toneLabel[tone]}`,
  });
}

// Ícone de app: quadrado 96 com raio 22 e o símbolo em 90×75 centralizado (prancha 02).
const appIconBody = (symbol, bg, name, rx = 22) =>
  `<rect width="96" height="96" rx="${rx}" fill="${bg}"/>${symbolGroup(symbol, [3, 10.5], 90 / 240, `ss-clip-${name}`)}`;
addAsset('app-icon', {
  width: 96,
  height: 96,
  body: appIconBody(symbols.appMar, MAR, 'app-icon'),
  clearSpace: 0,
  description: 'Ícone de app, fundo Mar',
});
addAsset('app-icon-sol', {
  width: 96,
  height: 96,
  body: appIconBody(symbols.appSol, SOL, 'app-icon-sol'),
  clearSpace: 0,
  description: 'Ícone de app, fundo Sol',
});

// Favicon simplificado (abaixo de 40 px): quadrado 32 com raio 7 e o desenho 100×100 em 28×28.
const faviconBody = `<rect width="32" height="32" rx="7" fill="${MAR}"/><g transform="translate(2 2) scale(0.28)">${symbols.favicon.inner}</g>`;
addAsset('favicon', {
  width: 32,
  height: 32,
  body: faviconBody,
  clearSpace: 0,
  description: 'Favicon simplificado (sem malha e sem rastros), para menos de 40 px',
});

mkdirSync(pngDir, { recursive: true });
for (const asset of Object.values(assets)) {
  writeFileSync(join(brandDir, asset.file), `${asset.svg}\n`);
}

// ---------------------------------------------------------------------------------------------
// PNGs dos apps.

function png(file, svg, width) {
  const out = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
  writeFileSync(join(pngDir, file), out);
}

const appSymbolBox = inkBox(symbolGroup(symbols.appMar, [0, 0], 1, 'b'), 240, 200);

/** Símbolo centrado pela tinta num quadrado `size`, com a tinta cabendo num círculo de diâmetro `fit`. */
function centeredSymbol(symbol, size, fit, clipId) {
  const diag = Math.hypot(appSymbolBox.w, appSymbolBox.h);
  const scale = fit / diag;
  const x = size / 2 - (appSymbolBox.x + appSymbolBox.w / 2) * scale;
  const y = size / 2 - (appSymbolBox.y + appSymbolBox.h / 2) * scale;
  return symbolGroup(symbol, [x, y], scale, clipId);
}

// iOS/Expo: quadrado sem cantos nem transparência (o sistema aplica a máscara).
const squareIcon = svgDoc('0 0 96 96', 96, 96, appIconBody(symbols.appMar, MAR, 'icon', 0));
png('icon.png', squareIcon, 1024);
png('apple-touch-icon.png', squareIcon, 180);

// Android adaptive icon (108 dp): a tinta cabe no círculo seguro de 66 dp.
const adaptive = (body) => svgDoc('0 0 108 108', 108, 108, body);
png('android-icon-foreground.png', adaptive(centeredSymbol(symbols.appMar, 108, 66, 'fg')), 1024);
png(
  'android-icon-background.png',
  adaptive(`<rect width="108" height="108" fill="${MAR}"/>`),
  1024,
);
// Monocromático: o Android usa só o alfa, então a bola fica vazada (sem o preenchimento escuro).
const monoOutline = {
  inner: symbols.monoWhite.inner.replaceAll(`fill="${NOITE}"`, 'fill="none"'),
};
png('android-icon-monochrome.png', adaptive(centeredSymbol(monoOutline, 108, 66, 'mono')), 1024);

// Splash: símbolo (versão do ícone, para o fundo Mar ou Noite) com a área de proteção em volta.
{
  const scale = 1024 / Math.max(appSymbolBox.w + 2 * BALL.r, appSymbolBox.h + 2 * BALL.r);
  const x = 512 - (appSymbolBox.x + appSymbolBox.w / 2) * scale;
  const y = 512 - (appSymbolBox.y + appSymbolBox.h / 2) * scale;
  png(
    'splash-icon.png',
    svgDoc('0 0 1024 1024', 1024, 1024, symbolGroup(symbols.appMar, [x, y], scale, 'splash')),
    1024,
  );
}

const favicon = svgDoc('0 0 32 32', 32, 32, faviconBody);
png('favicon-48.png', favicon, 48);
png('favicon-32.png', favicon, 32);

// Open Graph 1200×630: horizontal negativa sobre Mar, 640 px de largura, centralizada.
{
  const logo = assets['logo-horizontal-negative'];
  const scale = 640 / logo.width;
  const x = (1200 - 640) / 2;
  const y = (630 - logo.height * scale) / 2;
  const body = `<rect width="1200" height="630" fill="${MAR}"/><g transform="translate(${n(x)} ${n(y)}) scale(${+scale.toFixed(6)})">${logo.svg.replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>`;
  png('og-image.png', svgDoc('0 0 1200 630', 1200, 630, body), 1200);
}

// ---------------------------------------------------------------------------------------------
// src/brand-assets.ts: markup e dimensões, para o web (inline) e o mobile (SvgXml).

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const tsFile = join(pkgDir, 'src', 'brand-assets.ts');
const ts = [
  '/* Gerado por scripts/brand.mjs a partir de docs/brand/kit/02-kit-de-logos.html. Não edite à mão. */',
  '',
  ...Object.entries(assets).flatMap(([name, a]) => [
    `/** ${a.description}. */`,
    `export const ${camel(name)} = {`,
    `  name: '${name}',`,
    `  file: '${a.file}',`,
    `  width: ${a.width},`,
    `  height: ${a.height},`,
    `  clearSpace: ${a.clearSpace},`,
    `  svg: '${a.svg}',`,
    '} as const;',
    '',
  ]),
].join('\n');
writeFileSync(tsFile, ts);
execFileSync(join(repoDir, 'node_modules', '.bin', 'biome'), ['format', '--write', tsFile], {
  stdio: 'inherit',
});

for (const a of Object.values(assets)) console.log(`brand/${a.file} (${a.width}×${a.height})`);
console.log('brand/png/*.png, src/brand-assets.ts');
