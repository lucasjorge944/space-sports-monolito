# Postgres 17 com PostGIS para arm64 e amd64. O staging roda em Graviton, e postgis/postgis:17-3.5
# (a imagem de dev e da CI) só publica amd64.
#
# A base é a imagem oficial do Postgres, multiarquitetura, que já vem com o repositório do PGDG
# configurado. btree_gist faz parte dela. O PGDG não tem mais a série 3.5 para o Postgres 17, então
# a versão fixa é a 3.6, a mais próxima da usada em dev e na CI.
FROM postgres:17.11-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         ca-certificates \
         'postgresql-17-postgis-3=3.6.*' \
         'postgresql-17-postgis-3-scripts=3.6.*' \
    && rm -rf /var/lib/apt/lists/*
