-- Extensões usadas pelo schema:
-- postgis: geography(Point,4326) em spaces.location (busca geográfica).
-- btree_gist: permite `court_id WITH =` (uuid) na constraint de exclusão de court_occupations.
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
-- uuid v7 (RFC 9562): 48 bits de timestamp em ms + bits aleatórios. O Postgres 17 ainda não tem
-- uuidv7() nativo (só no 18); esta função é o default de todas as chaves primárias.
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE
AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid;
$$;
