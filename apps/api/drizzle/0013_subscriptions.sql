-- Assinaturas e mensalidades das aulas (Fase 2, tarefa 2.2): matrícula PENDING (turma pedida),
-- aprovação/recusa/cancelamento e saldo anual de pausa na assinatura, lembretes e dispensa na
-- mensalidade.
ALTER TYPE "public"."enrollment_status" ADD VALUE 'PENDING';--> statement-breakpoint
ALTER TABLE "subscription_charges" ADD COLUMN "due_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscription_charges" ADD COLUMN "overdue_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscription_charges" ADD COLUMN "waived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscription_charges" ADD COLUMN "waived_by" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pause_year" smallint;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "ends_on" date;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancelled_by" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "subscription_charges" ADD CONSTRAINT "subscription_charges_waived_by_users_id_fk" FOREIGN KEY ("waived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_charges_waived_by_idx" ON "subscription_charges" USING btree ("waived_by");--> statement-breakpoint
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_approved_by_idx" ON "subscriptions" USING btree ("approved_by");--> statement-breakpoint
CREATE INDEX "subscriptions_cancelled_by_idx" ON "subscriptions" USING btree ("cancelled_by");--> statement-breakpoint
ALTER TABLE "subscription_charges" ADD CONSTRAINT "subscription_charges_waive_consistent" CHECK (("subscription_charges"."status" = 'WAIVED') = ("subscription_charges"."waived_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_cancel_has_end" CHECK (NOT "subscriptions"."cancel_at_period_end" OR "subscriptions"."ends_on" IS NOT NULL);