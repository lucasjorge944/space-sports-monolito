import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { exportOpenApiDocument } from './export-openapi.js';

// Uso: node dist/openapi/export.js <arquivo.json>. Roda o build (tsc), não o tsx: o esbuild não
// emite os metadados de decorators de que a injeção do Nest e o Swagger dependem.
const [target] = process.argv.slice(2);
if (!target) {
  console.error('Uso: node dist/openapi/export.js <arquivo.json>');
  process.exit(1);
}

const file = resolve(target);
const document = await exportOpenApiDocument();
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
console.log(`OpenAPI exportado em ${file}`);
