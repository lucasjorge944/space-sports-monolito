CREATE TYPE "public"."gender" AS ENUM('FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED');--> statement-breakpoint
-- Decisão 64: o telefone do cadastro não é verificado e pode se repetir; só o verificado é único
-- (índice parcial no fim). Números digitados não revelam se outro cadastro existe.
ALTER TABLE "users" DROP CONSTRAINT "users_phone_unique";--> statement-breakpoint
ALTER TABLE "user_sport_profiles" DROP CONSTRAINT "user_sport_profiles_sport_id_sports_id_fk";
--> statement-breakpoint
-- Decisão 69: o nível do esporte favorito é opcional.
ALTER TABLE "user_sport_profiles" ALTER COLUMN "level" DROP NOT NULL;--> statement-breakpoint
-- Decisão 68: o gênero era texto livre e não era usado. Valores que já sejam do enum (em qualquer
-- caixa) são mantidos; nulos ficam nulos e qualquer outro texto vira nulo.
ALTER TABLE "users" ALTER COLUMN "gender" SET DATA TYPE "public"."gender" USING (
	CASE
		WHEN upper(btrim("gender")) IN ('FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED')
			THEN upper(btrim("gender"))::"public"."gender"
		ELSE NULL
	END
);--> statement-breakpoint
-- Tirar o esporte do catálogo leva junto os favoritos (eles não podem travar o Super).
ALTER TABLE "user_sport_profiles" ADD CONSTRAINT "user_sport_profiles_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_verified_unique" ON "users" USING btree ("phone") WHERE "users"."phone_verified";
