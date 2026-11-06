# Imagem de produção da API; a mesma imagem roda as migrações e os seeds (apps/api/README.md).
# O contexto do build é a raiz do monorepo:
#   docker build -f apps/api/Dockerfile -t space-sports-api .
# Não usa recursos do BuildKit: funciona no `docker build` clássico e no buildx. Nenhum segredo
# passa pelo build; as variáveis de ambiente entram só no `docker run`.

# O FROM não lê arquivos: a versão fica aqui, e o estágio `prune` confere com o .nvmrc.
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY package.json ./
RUN corepack enable pnpm && corepack install

# Reduz o monorepo ao que a API usa. O `json/` só muda com o manifesto ou o lockfile, então a
# instalação fica em cache quando só o código muda.
FROM base AS prune
COPY . .
RUN test "$(cut -d. -f1 .nvmrc)" = "$(node -p 'process.versions.node.split(".")[0]')"
RUN pnpm dlx "turbo@$(node -p "require('./package.json').devDependencies.turbo")" \
      prune @space-sports/api --docker

FROM base AS build
COPY --from=prune /repo/out/json/ ./
# Sem scripts: nenhum é necessário para o build, que usa o tsc (`nest build`).
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --from=prune /repo/out/full/ ./
RUN NODE_OPTIONS=--max-old-space-size=2048 pnpm exec turbo run build --filter=@space-sports/api
# Copia o que o campo `files` do package.json lista (dist e drizzle) e só as dependências de produção.
# --no-optional: o lockfile resolve os peers opcionais do better-auth e do @better-auth/expo com os
# pacotes do mobile e do web, e sem a flag a imagem levaria Expo, React Native e Next (800 MB a mais).
# Atenção: a flag também tira binários nativos instalados por optionalDependencies (como o sharp).
# Hoje a API não tem nenhum; se passar a ter, ajuste este passo e confira a imagem.
RUN pnpm --filter @space-sports/api deploy --legacy --prod --no-optional --ignore-scripts /out

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Os arquivos ficam com o root: o processo não altera o próprio código.
COPY --from=build /out/ ./
USER node
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 3333}/v1/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
