CREATE TABLE "subscription_pause_months" (
	"subscription_id" uuid NOT NULL,
	"month" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_pause_months_subscription_id_month_pk" PRIMARY KEY("subscription_id","month"),
	CONSTRAINT "subscription_pause_months_first_day" CHECK (extract(day from "subscription_pause_months"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_pause_months_per_year" smallint;--> statement-breakpoint
ALTER TABLE "space_settings" ADD COLUMN "max_pause_months_per_year" smallint;--> statement-breakpoint
ALTER TABLE "subscription_pause_months" ADD CONSTRAINT "subscription_pause_months_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_max_pause_months_per_year_range" CHECK ("plans"."max_pause_months_per_year" BETWEEN 0 AND 12);--> statement-breakpoint
ALTER TABLE "space_settings" ADD CONSTRAINT "space_settings_max_pause_months_per_year_range" CHECK ("space_settings"."max_pause_months_per_year" BETWEEN 0 AND 12);--> statement-breakpoint
-- Decisão 41: limites em dias viram meses (30 dias = 1 mês, arredondando para cima).
UPDATE "space_settings" SET "max_pause_months_per_year" = LEAST(12, CEIL("max_pause_days_per_year" / 30.0))::smallint WHERE "max_pause_days_per_year" IS NOT NULL;--> statement-breakpoint
UPDATE "plans" SET "max_pause_months_per_year" = LEAST(12, CEIL("max_pause_days_per_year" / 30.0))::smallint WHERE "max_pause_days_per_year" IS NOT NULL;--> statement-breakpoint
-- Pausas em andamento ou agendadas viram meses inteiros (do dia 1 do primeiro mês ao último dia do mês final).
UPDATE "subscriptions" SET "paused_from" = date_trunc('month', "paused_from")::date, "paused_until" = (date_trunc('month', "paused_until") + interval '1 month - 1 day')::date WHERE "paused_from" IS NOT NULL AND "paused_until" IS NOT NULL AND ("status" = 'PAUSED' OR "paused_until" >= current_date) AND "status" <> 'CANCELLED';--> statement-breakpoint
INSERT INTO "subscription_pause_months" ("subscription_id", "month") SELECT s."id", m::date FROM "subscriptions" s, generate_series(s."paused_from", s."paused_until", interval '1 month') AS m WHERE s."paused_from" IS NOT NULL AND s."paused_until" IS NOT NULL AND (s."status" = 'PAUSED' OR s."paused_until" >= current_date) AND s."status" <> 'CANCELLED' ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "plans" DROP CONSTRAINT "plans_max_pause_days_per_year_range";--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_pause_days_used_non_negative";--> statement-breakpoint
ALTER TABLE "space_settings" DROP CONSTRAINT "space_settings_max_pause_days_per_year_range";--> statement-breakpoint
ALTER TABLE "space_settings" DROP CONSTRAINT "space_settings_min_pause_days_range";--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN "max_pause_days_per_year";--> statement-breakpoint
ALTER TABLE "subscriptions" DROP COLUMN "pause_days_used";--> statement-breakpoint
ALTER TABLE "subscriptions" DROP COLUMN "pause_year";--> statement-breakpoint
ALTER TABLE "space_settings" DROP COLUMN "max_pause_days_per_year";--> statement-breakpoint
ALTER TABLE "space_settings" DROP COLUMN "min_pause_days";
