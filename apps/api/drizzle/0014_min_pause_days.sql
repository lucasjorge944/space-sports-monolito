ALTER TABLE "subscriptions" ADD COLUMN "billing_processed_on" date;--> statement-breakpoint
ALTER TABLE "space_settings" ADD COLUMN "min_pause_days" integer;--> statement-breakpoint
ALTER TABLE "space_settings" ADD CONSTRAINT "space_settings_min_pause_days_range" CHECK ("space_settings"."min_pause_days" BETWEEN 1 AND 365);