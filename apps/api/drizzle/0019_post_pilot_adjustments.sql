ALTER TABLE "space_members" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "staff_invites" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
-- Decisão 46: o papel que saiu é o único valor fora da lista nova e vira ADMIN. Quem já tem a linha
-- de ADMIN fica só com ela, no status mais forte das duas (sem duplicar o vínculo nem perder acesso).
UPDATE "space_members" AS "admin"
SET
	"status" = CASE
		WHEN 'ACTIVE' IN ("admin"."status", "legacy"."status") THEN 'ACTIVE'::"space_member_status"
		WHEN 'INVITED' IN ("admin"."status", "legacy"."status") THEN 'INVITED'::"space_member_status"
		ELSE 'REMOVED'::"space_member_status"
	END,
	"updated_at" = now()
FROM "space_members" AS "legacy"
WHERE "admin"."role" = 'ADMIN'
	AND "legacy"."role" NOT IN ('OWNER', 'ADMIN', 'TEACHER')
	AND "legacy"."user_id" = "admin"."user_id"
	AND "legacy"."space_id" = "admin"."space_id";--> statement-breakpoint
DELETE FROM "space_members" AS "legacy"
USING "space_members" AS "admin"
WHERE "admin"."role" = 'ADMIN'
	AND "legacy"."role" NOT IN ('OWNER', 'ADMIN', 'TEACHER')
	AND "legacy"."user_id" = "admin"."user_id"
	AND "legacy"."space_id" = "admin"."space_id";--> statement-breakpoint
UPDATE "space_members"
SET "role" = 'ADMIN', "updated_at" = now()
WHERE "role" NOT IN ('OWNER', 'ADMIN', 'TEACHER');--> statement-breakpoint
-- O índice parcial aceita um convite pendente por espaço, e-mail e papel: se a pessoa tinha os dois,
-- fica o de prazo maior (no empate, o de ADMIN) e o outro é revogado.
UPDATE "staff_invites" AS "revoked"
SET "status" = 'REVOKED'
FROM "staff_invites" AS "kept"
WHERE "revoked"."status" = 'PENDING'
	AND "kept"."status" = 'PENDING'
	AND "kept"."space_id" = "revoked"."space_id"
	AND "kept"."email" = "revoked"."email"
	AND (
		("kept"."role" = 'ADMIN' AND "revoked"."role" NOT IN ('OWNER', 'ADMIN', 'TEACHER') AND "kept"."expires_at" >= "revoked"."expires_at")
		OR ("revoked"."role" = 'ADMIN' AND "kept"."role" NOT IN ('OWNER', 'ADMIN', 'TEACHER') AND "kept"."expires_at" > "revoked"."expires_at")
	);--> statement-breakpoint
UPDATE "staff_invites"
SET "role" = 'ADMIN'
WHERE "role" NOT IN ('OWNER', 'ADMIN', 'TEACHER');--> statement-breakpoint
DROP TYPE "public"."space_member_role";--> statement-breakpoint
CREATE TYPE "public"."space_member_role" AS ENUM('OWNER', 'ADMIN', 'TEACHER');--> statement-breakpoint
ALTER TABLE "space_members" ALTER COLUMN "role" SET DATA TYPE "public"."space_member_role" USING "role"::"public"."space_member_role";--> statement-breakpoint
ALTER TABLE "staff_invites" ALTER COLUMN "role" SET DATA TYPE "public"."space_member_role" USING "role"::"public"."space_member_role";--> statement-breakpoint
-- Decisão 50: o status por participante sai; os pagamentos antigos seguem em payment_records.
ALTER TABLE "booking_participants" DROP COLUMN "payment_status";--> statement-breakpoint
DROP TYPE "public"."participant_payment_status";--> statement-breakpoint
-- Decisão 51: a capacidade sai do cadastro e vale o padrão do esporte (até 20, decisão 18).
UPDATE "court_sports" AS "cs"
SET "max_players" = LEAST(COALESCE("s"."default_max_players", 20), 20), "updated_at" = now()
FROM "sports" AS "s"
WHERE "s"."id" = "cs"."sport_id"
	AND "cs"."max_players" <> LEAST(COALESCE("s"."default_max_players", 20), 20);
