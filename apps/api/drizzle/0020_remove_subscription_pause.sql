-- Decisão 45: a pausa das assinaturas de aula deixa de existir (a do mensalista não muda).
ALTER TABLE "subscription_charges" ADD COLUMN "waive_reason" text;--> statement-breakpoint
-- O mês corrente, trancado, continua sem cobrança: a dispensa impede o job de gerar mensalidade retroativa ao voltar a ACTIVE.
INSERT INTO "subscription_charges" ("subscription_id", "period_start", "period_end", "due_date", "amount_cents", "status", "waived_at", "waive_reason")
SELECT s."id", m."start", (m."start" + interval '1 month - 1 day')::date, m."start" + (p."billing_day" - 1), s."price_cents", 'WAIVED', now(), 'Mês trancado antes do fim da pausa de plano'
FROM "subscriptions" s
INNER JOIN "plans" p ON p."id" = s."plan_id"
INNER JOIN "spaces" sp ON sp."id" = s."space_id"
INNER JOIN "cities" c ON c."id" = sp."city_id"
CROSS JOIN LATERAL (SELECT date_trunc('month', now() AT TIME ZONE coalesce(nullif(c."timezone", ''), 'America/Sao_Paulo'))::date AS "start") m
WHERE s."status" IN ('ACTIVE', 'PAUSED', 'PAST_DUE')
  AND ((s."paused_from" <= m."start" AND s."paused_until" >= (m."start" + interval '1 month - 1 day')::date)
    OR (s."status" = 'PAUSED' AND s."paused_until" IS NULL))
ON CONFLICT ("subscription_id", "period_start") DO NOTHING;--> statement-breakpoint
-- O motivo guardado era o da pausa; com cancelamento pedido, é o do cancelamento e fica.
UPDATE "subscriptions" SET "status_reason" = NULL WHERE "status" IN ('ACTIVE', 'PAUSED', 'PAST_DUE') AND "paused_from" IS NOT NULL AND NOT "cancel_at_period_end";--> statement-breakpoint
UPDATE "subscriptions" SET "status" = 'ACTIVE' WHERE "status" = 'PAUSED';--> statement-breakpoint
DROP TABLE "subscription_pause_months" CASCADE;--> statement-breakpoint
ALTER TABLE "plans" DROP CONSTRAINT "plans_max_pause_months_per_year_range";--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_pause_valid";--> statement-breakpoint
ALTER TABLE "space_settings" DROP CONSTRAINT "space_settings_max_pause_months_per_year_range";--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN "pause_allowed";--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN "max_pause_months_per_year";--> statement-breakpoint
ALTER TABLE "subscriptions" DROP COLUMN "paused_from";--> statement-breakpoint
ALTER TABLE "subscriptions" DROP COLUMN "paused_until";--> statement-breakpoint
ALTER TABLE "space_settings" DROP COLUMN "max_pause_months_per_year";--> statement-breakpoint
-- O índice parcial cita o enum: sai antes da troca do tipo e volta sem PAUSED.
DROP INDEX "subscriptions_open_user_plan_unique";--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."subscription_status";--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('PENDING_APPROVAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED');--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "status" SET DATA TYPE "public"."subscription_status" USING "status"::"public"."subscription_status";--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "status" SET DEFAULT 'PENDING_APPROVAL';--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_open_user_plan_unique" ON "subscriptions" USING btree ("user_id","plan_id") WHERE "subscriptions"."status" IN ('PENDING_APPROVAL', 'ACTIVE', 'PAST_DUE');
