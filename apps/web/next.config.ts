import { join } from 'node:path';
import type { NextConfig } from 'next';

// Origem da API (sem /v1). Lida no build: o rewrite entra no manifesto de rotas.
const apiUrl = (process.env.API_URL ?? 'http://localhost:3333').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Imagem Docker (apps/web/Dockerfile): o `next build` gera .next/standalone; o `next dev` ignora.
  output: 'standalone',
  // Monorepo: o tracing precisa alcançar packages/ e o node_modules da raiz.
  outputFileTracingRoot: join(__dirname, '../..'),
  // `@space-sports/api-client` é CJS e resolve o react-query pelo `require` (build/modern/index.cjs),
  // enquanto o app usa o `import` (index.js): duas cópias, dois contextos, e os hooks gerados não
  // enxergam o QueryClientProvider. O alias fixa uma só cópia.
  turbopack: {
    resolveAlias: {
      '@tanstack/react-query': './node_modules/@tanstack/react-query/build/modern/index.js',
    },
  },
  // O e2e sobe um `next dev` próprio; separar o diretório evita brigar com build/typecheck no turbo.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // O browser fala com a API pelo mesmo domínio do web: o cookie de sessão fica no nosso domínio
  // e o `proxy.ts` consegue enxergá-lo.
  async rewrites() {
    return [{ source: '/v1/:path*', destination: `${apiUrl}/v1/:path*` }];
  },
};

export default nextConfig;
