# Imagem de produção do servidor MCP (apps/mcp), no mesmo padrão da imagem da API.
# O contexto do build é a raiz do monorepo:
#   docker build -f apps/mcp/Dockerfile -t space-sports-mcp .
# Não usa recursos do BuildKit. Nenhum segredo passa pelo build: as variáveis de ambiente
# (inclusive MCP_CONFIRMATION_SECRET) entram só no `docker run`.

# O FROM não lê arquivos: a versão fica aqui, e o estágio `prune` confere com o .nvmrc.
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY package.json ./
RUN corepack enable pnpm && corepack install

# Reduz o monorepo ao que o MCP usa (ele, o api-client e o shared).
FROM base AS prune
COPY . .
RUN test "$(cut -d. -f1 .nvmrc)" = "$(node -p 'process.versions.node.split(".")[0]')"
RUN pnpm dlx "turbo@$(node -p "require('./package.json').devDependencies.turbo")" \
      prune @space-sports/mcp --docker

FROM base AS build
COPY --from=prune /repo/out/json/ ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --from=prune /repo/out/full/ ./
RUN NODE_OPTIONS=--max-old-space-size=2048 pnpm exec turbo run build --filter=@space-sports/mcp
# Só o `dist` e as dependências de produção. --no-optional: tira os peers opcionais do
# better-auth (adaptadores de banco, frameworks), que o MCP não usa.
RUN pnpm --filter @space-sports/mcp deploy --legacy --prod --no-optional --ignore-scripts /out

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Os arquivos ficam com o root: o processo não altera o próprio código.
COPY --from=build /out/ ./
USER node
EXPOSE 3340
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 3340}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
