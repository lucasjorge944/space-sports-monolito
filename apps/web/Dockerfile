# Imagem de produção do web (Next em `output: 'standalone'`).
# O contexto do build é a raiz do monorepo, e API_URL é obrigatório:
#   docker build -f apps/web/Dockerfile --build-arg API_URL=http://api:3333 -t space-sports-web .
# Não usa recursos do BuildKit: funciona no `docker build` clássico e no buildx. API_URL é um
# endereço interno, não um segredo. Comandos e variáveis: apps/api/README.md.

# O FROM não lê arquivos: a versão fica aqui, e o estágio `prune` confere com o .nvmrc.
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY package.json ./
RUN corepack enable pnpm && corepack install

# Reduz o monorepo ao que o web usa. O `json/` só muda com o manifesto ou o lockfile, então a
# instalação fica em cache quando só o código muda.
FROM base AS prune
COPY . .
RUN test "$(cut -d. -f1 .nvmrc)" = "$(node -p 'process.versions.node.split(".")[0]')"
RUN pnpm dlx "turbo@$(node -p "require('./package.json').devDependencies.turbo")" \
      prune @space-sports/web --docker

FROM base AS build
ARG API_URL
# Sem ele, o rewrite de /v1 iria para o localhost de dentro do contêiner, sem nenhum erro no build.
RUN test -n "$API_URL" || { echo 'Defina --build-arg API_URL=<origem da API>' >&2; exit 1; }
COPY --from=prune /repo/out/json/ ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --from=prune /repo/out/full/ ./
RUN NODE_OPTIONS=--max-old-space-size=2048 pnpm exec turbo run build --filter=@space-sports/web
# O projeto ainda não tem public/, e o COPY do estágio final falharia sem a pasta.
RUN mkdir -p apps/web/public

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG API_URL
# API_URL: o rewrite já saiu do build; aqui é o padrão de quem lê em tempo de execução
# (server-session.ts e server-api.ts). HOSTNAME: o Docker define o id do contêiner, e o server.js
# escutaria só nesse endereço, sem responder em 127.0.0.1.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    API_URL=${API_URL}
WORKDIR /app
# O dono é o usuário `node`: o Next grava o cache de dados e de imagens em .next/.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone/ ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static/ ./apps/web/.next/static/
COPY --from=build --chown=node:node /repo/apps/web/public/ ./apps/web/public/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/web/server.js"]
