CREATE TYPE "public"."attendance_mode" AS ENUM('AUTOMATIC', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."booking_payment_status" AS ENUM('PENDING', 'PARTIALLY_PAID', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."booking_source" AS ENUM('APP', 'DESK', 'RECURRING');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."charge_status" AS ENUM('PENDING', 'PAID', 'OVERDUE', 'WAIVED');--> statement-breakpoint
CREATE TYPE "public"."court_status" AS ENUM('ACTIVE', 'MAINTENANCE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."device_platform" AS ENUM('IOS', 'ANDROID');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('INVITED', 'ACCEPTED', 'DECLINED');--> statement-breakpoint
CREATE TYPE "public"."occupation_kind" AS ENUM('BOOKING', 'CLASS', 'TOURNAMENT', 'BLOCK');--> statement-breakpoint
CREATE TYPE "public"."participant_payment_status" AS ENUM('PENDING', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."payable_type" AS ENUM('BOOKING', 'BOOKING_PARTICIPANT', 'RECURRING_BOOKING_CHARGE', 'SUBSCRIPTION_CHARGE', 'TEAM');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('PIX', 'CARD', 'CASH', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('USER', 'SUPER');--> statement-breakpoint
CREATE TYPE "public"."recurring_booking_status" AS ENUM('PENDING_APPROVAL', 'ACTIVE', 'PAUSED', 'ENDED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."space_member_role" AS ENUM('OWNER', 'ADMIN', 'TEACHER', 'RECEPTION');--> statement-breakpoint
CREATE TYPE "public"."space_member_status" AS ENUM('INVITED', 'ACTIVE', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."space_status" AS ENUM('ACTIVE', 'SUSPENDED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."sport_level" AS ENUM('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'PRO');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'BLOCKED');--> statement-breakpoint
CREATE TABLE "amenities" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "amenities_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"timezone" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cities_name_state_unique" UNIQUE("name","state"),
	CONSTRAINT "cities_state_format" CHECK ("cities"."state" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "sports" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"default_max_players" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_slug_unique" UNIQUE("slug"),
	CONSTRAINT "sports_default_max_players_positive" CHECK ("sports"."default_max_players" > 0)
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"expo_push_token" text NOT NULL,
	"platform" "device_platform" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_expo_push_token_unique" UNIQUE("expo_push_token")
);
--> statement-breakpoint
CREATE TABLE "space_members" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"role" "space_member_role" NOT NULL,
	"status" "space_member_status" DEFAULT 'INVITED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_members_user_space_role_unique" UNIQUE("user_id","space_id","role")
);
--> statement-breakpoint
CREATE TABLE "user_sport_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"sport_id" uuid NOT NULL,
	"level" "sport_level" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_sport_profiles_user_sport_unique" UNIQUE("user_id","sport_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"avatar_url" text,
	"birth_date" date,
	"gender" text,
	"platform_role" "platform_role" DEFAULT 'USER' NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "payment_records" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"space_id" uuid NOT NULL,
	"payable_type" "payable_type" NOT NULL,
	"payable_id" uuid NOT NULL,
	"payer_user_id" uuid,
	"amount_cents" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"recorded_by" uuid NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_records_amount_cents_positive" CHECK ("payment_records"."amount_cents" > 0),
	CONSTRAINT "payment_records_reversal_consistent" CHECK (("payment_records"."reversed_at" IS NULL) = ("payment_records"."reversed_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"actor_id" uuid,
	"acting_as_super" boolean DEFAULT false NOT NULL,
	"space_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"diff" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_checklists" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"space_id" uuid NOT NULL,
	"items" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_checklists_space_id_unique" UNIQUE("space_id")
);
--> statement-breakpoint
CREATE TABLE "booking_participants" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"booking_id" uuid NOT NULL,
	"user_id" uuid,
	"invite_token" text NOT NULL,
	"name" text,
	"share_cents" integer NOT NULL,
	"status" "invite_status" DEFAULT 'INVITED' NOT NULL,
	"payment_status" "participant_payment_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_participants_invite_token_unique" UNIQUE("invite_token"),
	CONSTRAINT "booking_participants_booking_user_unique" UNIQUE("booking_id","user_id"),
	CONSTRAINT "booking_participants_share_cents_non_negative" CHECK ("booking_participants"."share_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"space_id" uuid NOT NULL,
	"court_id" uuid NOT NULL,
	"organizer_user_id" uuid,
	"guest_name" text,
	"guest_phone" text,
	"sport_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"duration_min" integer NOT NULL,
	"people_count" integer NOT NULL,
	"price_per_hour_cents" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"status" "booking_status" DEFAULT 'CONFIRMED' NOT NULL,
	"payment_status" "booking_payment_status" DEFAULT 'PENDING' NOT NULL,
	"intended_payment_method" "payment_method",
	"source" "booking_source" NOT NULL,
	"recurring_booking_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_period_valid" CHECK ("bookings"."ends_at" > "bookings"."starts_at"),
	CONSTRAINT "bookings_duration_positive" CHECK ("bookings"."duration_min" > 0),
	CONSTRAINT "bookings_people_count_positive" CHECK ("bookings"."people_count" > 0),
	CONSTRAINT "bookings_prices_non_negative" CHECK ("bookings"."price_per_hour_cents" >= 0 AND "bookings"."price_cents" >= 0),
	CONSTRAINT "bookings_organizer_or_guest" CHECK ("bookings"."organizer_user_id" IS NOT NULL OR "bookings"."guest_name" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "recurring_booking_charges" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"recurring_booking_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"due_date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" charge_status DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_booking_charges_booking_period_unique" UNIQUE("recurring_booking_id","period_start"),
	CONSTRAINT "recurring_booking_charges_amount_cents_non_negative" CHECK ("recurring_booking_charges"."amount_cents" >= 0),
	CONSTRAINT "recurring_booking_charges_period_valid" CHECK ("recurring_booking_charges"."period_end" >= "recurring_booking_charges"."period_start")
);
--> statement-breakpoint
CREATE TABLE "recurring_bookings" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"space_id" uuid NOT NULL,
	"court_id" uuid NOT NULL,
	"user_id" uuid,
	"guest_name" text,
	"guest_phone" text,
	"sport_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"duration_min" integer NOT NULL,
	"people_count" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"status" "recurring_booking_status" DEFAULT 'PENDING_APPROVAL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_bookings_weekday_range" CHECK ("recurring_bookings"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "recurring_bookings_duration_positive" CHECK ("recurring_bookings"."duration_min" > 0),
	CONSTRAINT "recurring_bookings_people_count_positive" CHECK ("recurring_bookings"."people_count" > 0),
	CONSTRAINT "recurring_bookings_dates_valid" CHECK ("recurring_bookings"."ends_on" IS NULL OR "recurring_bookings"."ends_on" >= "recurring_bookings"."starts_on"),
	CONSTRAINT "recurring_bookings_user_or_guest" CHECK ("recurring_bookings"."user_id" IS NOT NULL OR "recurring_bookings"."guest_name" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "court_blocks" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"court_id" uuid NOT NULL,
	"period" "tstzrange" NOT NULL,
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "court_blocks_period_valid" CHECK (NOT isempty("court_blocks"."period") AND NOT lower_inf("court_blocks"."period") AND NOT upper_inf("court_blocks"."period"))
);
--> statement-breakpoint
CREATE TABLE "court_occupations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"court_id" uuid NOT NULL,
	"period" "tstzrange" NOT NULL,
	"kind" "occupation_kind" NOT NULL,
	"ref_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "court_occupations_period_valid" CHECK (NOT isempty("court_occupations"."period") AND NOT lower_inf("court_occupations"."period") AND NOT upper_inf("court_occupations"."period") AND lower_inc("court_occupations"."period") AND NOT upper_inc("court_occupations"."period"))
);
--> statement-breakpoint
CREATE TABLE "court_sports" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"court_id" uuid NOT NULL,
	"sport_id" uuid NOT NULL,
	"max_players" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "court_sports_court_sport_unique" UNIQUE("court_id","sport_id"),
	CONSTRAINT "court_sports_max_players_positive" CHECK ("court_sports"."max_players" > 0)
);
--> statement-breakpoint
CREATE TABLE "courts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"space_id" uuid NOT NULL,
	"name" text NOT NULL,
	"covered" boolean DEFAULT false NOT NULL,
	"status" "court_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courts_space_name_unique" UNIQUE("space_id","name")
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_user_space_unique" UNIQUE("user_id","space_id")
);
--> statement-breakpoint
CREATE TABLE "space_amenities" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"space_id" uuid NOT NULL,
	"amenity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_amenities_space_amenity_unique" UNIQUE("space_id","amenity_id")
);
--> statement-breakpoint
CREATE TABLE "space_opening_hours" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"space_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"opens_at" time NOT NULL,
	"closes_at" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_opening_hours_weekday_range" CHECK ("space_opening_hours"."weekday" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE TABLE "space_photos" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"space_id" uuid NOT NULL,
	"url" text NOT NULL,
	"blurhash" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"space_id" uuid NOT NULL,
	"price_per_hour_cents" integer,
	"booking_min_duration_min" integer,
	"booking_max_duration_min" integer,
	"booking_min_advance_min" integer,
	"booking_window_days" integer,
	"cancellation_deadline_min" integer,
	"recurring_monthly_price_cents" integer,
	"recurring_billing_day" smallint,
	"attendance_mode" "attendance_mode",
	"attendance_open_before_min" integer,
	"attendance_close_before_min" integer,
	"attendance_cancel_deadline_min" integer,
	"past_due_block_days" integer,
	"max_pause_days_per_year" integer,
	"accepted_payment_methods" "payment_method"[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_settings_space_id_unique" UNIQUE("space_id"),
	CONSTRAINT "space_settings_price_per_hour_cents_non_negative" CHECK ("space_settings"."price_per_hour_cents" >= 0),
	CONSTRAINT "space_settings_recurring_monthly_price_cents_non_negative" CHECK ("space_settings"."recurring_monthly_price_cents" >= 0),
	CONSTRAINT "space_settings_recurring_billing_day_range" CHECK ("space_settings"."recurring_billing_day" BETWEEN 1 AND 31),
	CONSTRAINT "space_settings_booking_duration_range" CHECK ("space_settings"."booking_min_duration_min" > 0 AND "space_settings"."booking_max_duration_min" >= "space_settings"."booking_min_duration_min")
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"city_id" uuid NOT NULL,
	"address_street" text,
	"address_number" text,
	"address_neighborhood" text,
	"address_postal_code" text,
	"location" geography(Point,4326),
	"phone" text,
	"whatsapp" text,
	"instagram" text,
	"status" "space_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spaces_slug_unique" UNIQUE("slug"),
	CONSTRAINT "spaces_slug_format" CHECK ("spaces"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "spaces_address_postal_code_format" CHECK ("spaces"."address_postal_code" ~ '^[0-9]{8}$')
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sport_profiles" ADD CONSTRAINT "user_sport_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sport_profiles" ADD CONSTRAINT "user_sport_profiles_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_payer_user_id_users_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_checklists" ADD CONSTRAINT "onboarding_checklists_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_participants" ADD CONSTRAINT "booking_participants_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_participants" ADD CONSTRAINT "booking_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organizer_user_id_users_id_fk" FOREIGN KEY ("organizer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_recurring_booking_id_recurring_bookings_id_fk" FOREIGN KEY ("recurring_booking_id") REFERENCES "public"."recurring_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_booking_charges" ADD CONSTRAINT "recurring_booking_charges_recurring_booking_id_recurring_bookings_id_fk" FOREIGN KEY ("recurring_booking_id") REFERENCES "public"."recurring_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_bookings" ADD CONSTRAINT "recurring_bookings_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_bookings" ADD CONSTRAINT "recurring_bookings_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_bookings" ADD CONSTRAINT "recurring_bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_bookings" ADD CONSTRAINT "recurring_bookings_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_blocks" ADD CONSTRAINT "court_blocks_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_blocks" ADD CONSTRAINT "court_blocks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_occupations" ADD CONSTRAINT "court_occupations_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_sports" ADD CONSTRAINT "court_sports_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_sports" ADD CONSTRAINT "court_sports_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courts" ADD CONSTRAINT "courts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_amenities" ADD CONSTRAINT "space_amenities_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_amenities" ADD CONSTRAINT "space_amenities_amenity_id_amenities_id_fk" FOREIGN KEY ("amenity_id") REFERENCES "public"."amenities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_opening_hours" ADD CONSTRAINT "space_opening_hours_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_photos" ADD CONSTRAINT "space_photos_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_settings" ADD CONSTRAINT "space_settings_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_user_id_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "space_members_space_id_status_idx" ON "space_members" USING btree ("space_id","status");--> statement-breakpoint
CREATE INDEX "user_sport_profiles_sport_id_idx" ON "user_sport_profiles" USING btree ("sport_id");--> statement-breakpoint
CREATE INDEX "users_phone_idx" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "payment_records_payable_idx" ON "payment_records" USING btree ("payable_type","payable_id");--> statement-breakpoint
CREATE INDEX "payment_records_space_id_paid_at_idx" ON "payment_records" USING btree ("space_id","paid_at");--> statement-breakpoint
CREATE INDEX "payment_records_payer_user_id_idx" ON "payment_records" USING btree ("payer_user_id");--> statement-breakpoint
CREATE INDEX "payment_records_recorded_by_idx" ON "payment_records" USING btree ("recorded_by");--> statement-breakpoint
CREATE INDEX "payment_records_reversed_by_idx" ON "payment_records" USING btree ("reversed_by");--> statement-breakpoint
CREATE INDEX "audit_logs_space_id_created_at_idx" ON "audit_logs" USING btree ("space_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "booking_participants_user_id_idx" ON "booking_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bookings_court_id_starts_at_idx" ON "bookings" USING btree ("court_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_space_id_status_idx" ON "bookings" USING btree ("space_id","status");--> statement-breakpoint
CREATE INDEX "bookings_space_id_starts_at_idx" ON "bookings" USING btree ("space_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_organizer_user_id_starts_at_idx" ON "bookings" USING btree ("organizer_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_sport_id_idx" ON "bookings" USING btree ("sport_id");--> statement-breakpoint
CREATE INDEX "bookings_recurring_booking_id_idx" ON "bookings" USING btree ("recurring_booking_id");--> statement-breakpoint
CREATE INDEX "bookings_cancelled_by_idx" ON "bookings" USING btree ("cancelled_by");--> statement-breakpoint
CREATE INDEX "recurring_booking_charges_status_due_date_idx" ON "recurring_booking_charges" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "recurring_bookings_space_id_status_idx" ON "recurring_bookings" USING btree ("space_id","status");--> statement-breakpoint
CREATE INDEX "recurring_bookings_court_id_weekday_idx" ON "recurring_bookings" USING btree ("court_id","weekday");--> statement-breakpoint
CREATE INDEX "recurring_bookings_user_id_idx" ON "recurring_bookings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recurring_bookings_sport_id_idx" ON "recurring_bookings" USING btree ("sport_id");--> statement-breakpoint
CREATE INDEX "court_blocks_court_id_idx" ON "court_blocks" USING btree ("court_id");--> statement-breakpoint
CREATE INDEX "court_blocks_created_by_idx" ON "court_blocks" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "court_occupations_kind_ref_id_idx" ON "court_occupations" USING btree ("kind","ref_id");--> statement-breakpoint
CREATE INDEX "court_sports_sport_id_idx" ON "court_sports" USING btree ("sport_id");--> statement-breakpoint
CREATE INDEX "courts_space_id_status_idx" ON "courts" USING btree ("space_id","status");--> statement-breakpoint
CREATE INDEX "favorites_space_id_idx" ON "favorites" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "space_amenities_amenity_id_idx" ON "space_amenities" USING btree ("amenity_id");--> statement-breakpoint
CREATE INDEX "space_opening_hours_space_id_weekday_idx" ON "space_opening_hours" USING btree ("space_id","weekday");--> statement-breakpoint
CREATE INDEX "space_photos_space_id_position_idx" ON "space_photos" USING btree ("space_id","position");--> statement-breakpoint
CREATE INDEX "spaces_city_id_status_idx" ON "spaces" USING btree ("city_id","status");--> statement-breakpoint
CREATE INDEX "spaces_status_idx" ON "spaces" USING btree ("status");--> statement-breakpoint
CREATE INDEX "spaces_location_gist_idx" ON "spaces" USING gist ("location");