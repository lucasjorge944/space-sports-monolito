CREATE TABLE "recurring_booking_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"recurring_booking_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"conflicts_with" "occupation_kind" NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_booking_conflicts_booking_starts_at_unique" UNIQUE("recurring_booking_id","starts_at"),
	CONSTRAINT "recurring_booking_conflicts_period_valid" CHECK ("recurring_booking_conflicts"."ends_at" > "recurring_booking_conflicts"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "recurring_bookings" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "recurring_booking_conflicts" ADD CONSTRAINT "recurring_booking_conflicts_recurring_booking_id_recurring_bookings_id_fk" FOREIGN KEY ("recurring_booking_id") REFERENCES "public"."recurring_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_booking_conflicts_open_idx" ON "recurring_booking_conflicts" USING btree ("recurring_booking_id") WHERE "recurring_booking_conflicts"."resolved_at" IS NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_recurring_booking_starts_at_unique" UNIQUE("recurring_booking_id","starts_at");