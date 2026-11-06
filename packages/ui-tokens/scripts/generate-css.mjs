// Gera generated/*.css a partir de dist/ (rode via `pnpm generate`, que compila antes).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tokens from '../dist/index.js';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'generated');

for (const [file, generate] of Object.entries(tokens.generatedCssFiles)) {
  writeFileSync(join(outDir, file), generate());
  console.log(`generated/${file}`);
}
