CREATE TABLE "push_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancelled_by_pause" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_deliveries_created_at_idx" ON "push_deliveries" USING btree ("created_at");--> statement-breakpoint
-- Ocorrências já canceladas por pausa (antes, identificadas só pelo texto do motivo).
UPDATE "bookings" SET "cancelled_by_pause" = true
WHERE "recurring_booking_id" IS NOT NULL AND "status" = 'CANCELLED' AND "cancel_reason" = 'Mensalista pausado';
