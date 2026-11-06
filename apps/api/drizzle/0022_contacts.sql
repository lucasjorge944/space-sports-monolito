CREATE TYPE "public"."contact_origin" AS ENUM('BOOKING_INVITE_ORGANIZER', 'BOOKING_INVITE_SELF', 'DESK_BOOKING', 'RECURRING_DESK');--> statement-breakpoint
CREATE TABLE "contact_touchpoints" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"contact_id" uuid NOT NULL,
	"origin" "contact_origin" NOT NULL,
	"space_id" uuid NOT NULL,
	"booking_id" uuid,
	"captured_by" uuid,
	"name" text,
	"email" text,
	"phone" text,
	"marketing_consent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_touchpoints_email_or_phone" CHECK ("contact_touchpoints"."email" IS NOT NULL OR "contact_touchpoints"."phone" IS NOT NULL),
	CONSTRAINT "contact_touchpoints_email_normalized" CHECK ("contact_touchpoints"."email" = lower(btrim("contact_touchpoints"."email"))),
	CONSTRAINT "contact_touchpoints_phone_e164" CHECK ("contact_touchpoints"."phone" ~ '^[+][1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"user_id" uuid,
	"marketing_consent_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_email_or_phone" CHECK ("contacts"."email" IS NOT NULL OR "contacts"."phone" IS NOT NULL),
	CONSTRAINT "contacts_email_normalized" CHECK ("contacts"."email" = lower(btrim("contacts"."email"))),
	CONSTRAINT "contacts_phone_e164" CHECK ("contacts"."phone" ~ '^[+][1-9][0-9]{7,14}$')
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking_participants" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "booking_participants" ADD COLUMN "contact_via_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_touchpoints" ADD CONSTRAINT "contact_touchpoints_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_touchpoints" ADD CONSTRAINT "contact_touchpoints_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_touchpoints" ADD CONSTRAINT "contact_touchpoints_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_touchpoints" ADD CONSTRAINT "contact_touchpoints_captured_by_users_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_touchpoints_contact_id_idx" ON "contact_touchpoints" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_touchpoints_space_id_contact_id_idx" ON "contact_touchpoints" USING btree ("space_id","contact_id");--> statement-breakpoint
CREATE INDEX "contact_touchpoints_booking_id_idx" ON "contact_touchpoints" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "contact_touchpoints_email_idx" ON "contact_touchpoints" USING btree ("email");--> statement-breakpoint
CREATE INDEX "contact_touchpoints_phone_idx" ON "contact_touchpoints" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_email_unique" ON "contacts" USING btree ("email") WHERE "contacts"."email" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_phone_unique" ON "contacts" USING btree ("phone") WHERE "contacts"."phone" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "contacts_user_id_idx" ON "contacts" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "booking_participants" ADD CONSTRAINT "booking_participants_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_participants_contact_id_idx" ON "booking_participants" USING btree ("contact_id");--> statement-breakpoint
-- Conta verificada antes desta migração não é transição nova: nada de vínculo retroativo.
UPDATE "users" SET "email_verified_at" = "updated_at" WHERE "email_verified";
