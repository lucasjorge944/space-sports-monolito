// Gera o cliente a partir do OpenAPI da API, sem servidor no ar:
//   1. apps/api/dist/openapi/export.js grava o openapi.json (env fixo, login por telefone desligado);
//   2. o orval gera src/generated (funções fetch + hooks TanStack Query) usando src/mutator.ts.
// O openapi.json e o src/generated são versionados. Com --check, gera numa pasta temporária e
// falha se o resultado diferir do versionado (CI). Precisa do build da API: rode pela raiz,
// `pnpm generate:api-client` ou `pnpm generate:api-client:check`, que o turbo faz antes.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from 'orval';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiExport = resolve(root, '../../apps/api/dist/openapi/export.js');
const check = process.argv.includes('--check');

/** Arquivos versionados que o script produz. */
const ARTIFACTS = ['openapi.json', 'src/generated'];
/** Lidos pelo orval durante a geração (o import do mutator é relativo a eles). */
const MUTATOR_SOURCES = ['src/mutator.ts', 'src/errors.ts'];

if (!existsSync(apiExport)) {
  console.error(
    `Build da API não encontrado (${relative(root, apiExport)}). Rode pela raiz: pnpm generate:api-client`,
  );
  process.exit(1);
}

const outDir = check ? join(root, '.generate-check') : root;
try {
  if (check) {
    rmSync(outDir, { recursive: true, force: true });
    for (const file of MUTATOR_SOURCES) cpSync(join(root, file), join(outDir, file));
  }
  await generateInto(outDir);
  if (check) {
    const changed = ARTIFACTS.flatMap((artifact) =>
      diffPaths(join(root, artifact), join(outDir, artifact), artifact),
    );
    if (changed.length) {
      console.error(
        [
          'O cliente versionado está desatualizado em relação à API:',
          ...changed.map((file) => `  - packages/api-client/${file}`),
          'Rode `pnpm generate:api-client` na raiz e faça commit do resultado.',
        ].join('\n'),
      );
      process.exitCode = 1;
    } else {
      console.log('Cliente da API em dia com o OpenAPI.');
    }
  }
} finally {
  if (check) rmSync(outDir, { recursive: true, force: true });
}

async function generateInto(dir) {
  const spec = join(dir, 'openapi.json');
  mkdirSync(dir, { recursive: true });
  execFileSync(process.execPath, [apiExport, spec], { stdio: 'inherit' });
  await generate(
    {
      input: { target: spec },
      output: {
        mode: 'tags-split',
        target: join(dir, 'src/generated/endpoints'),
        schemas: join(dir, 'src/generated/model'),
        client: 'react-query',
        httpClient: 'fetch',
        clean: true,
        // Fixos no pacote, para a saída não depender da pasta de geração (modo --check).
        tsconfig: join(root, 'tsconfig.json'),
        packageJson: join(root, 'package.json'),
        override: {
          mutator: { path: join(dir, 'src/mutator.ts'), name: 'customFetch' },
          // O mutator devolve só o corpo e lança ApiError nos erros.
          fetch: { includeHttpResponseReturnType: false },
          query: { signal: true },
        },
      },
    },
    root,
    { logLevel: 'warn' },
  );
}

/** Caminhos (relativos ao pacote) que diferem entre o versionado e o gerado. */
function diffPaths(expected, actual, label) {
  const a = listFiles(expected);
  const b = listFiles(actual);
  const all = [...new Set([...a, ...b])].sort();
  return all
    .filter((file) => {
      const left = join(expected, file);
      const right = join(actual, file);
      return (
        !a.includes(file) || !b.includes(file) || !readFileSync(left).equals(readFileSync(right))
      );
    })
    .map((file) => (file ? `${label}/${file}` : label));
}

/** Arquivos sob `path` (relativos a ele); `['']` se `path` for um arquivo, `[]` se não existir. */
function listFiles(path) {
  if (!existsSync(path)) return [];
  try {
    return readdirSync(path, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(path, join(entry.parentPath, entry.name)));
  } catch {
    return [''];
  }
}
