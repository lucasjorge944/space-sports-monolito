-- Aulas (Fase 2, tarefa 2.1): turmas fixas, sessões, presença, planos, assinaturas, matrículas e
-- mensalidades, mais as configurações de atraso e pausa em space_settings.
CREATE TYPE "public"."attendance_status" AS ENUM('CONFIRMED', 'WAITLIST', 'CANCELLED', 'PRESENT', 'ABSENT');--> statement-breakpoint
CREATE TYPE "public"."class_session_status" AS ENUM('SCHEDULED', 'OPEN', 'CLOSED', 'DONE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('ACTIVE', 'ENDED');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('PENDING_APPROVAL', 'ACTIVE', 'PAUSED', 'PAST_DUE', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "attendances" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "attendance_status" NOT NULL,
	"waitlist_position" integer,
	"added_by_staff" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendances_session_user_unique" UNIQUE("session_id","user_id"),
	CONSTRAINT "attendances_waitlist_position_consistent" CHECK (("attendances"."status" = 'WAITLIST') = ("attendances"."waitlist_position" IS NOT NULL)),
	CONSTRAINT "attendances_waitlist_position_positive" CHECK ("attendances"."waitlist_position" > 0)
);
--> statement-breakpoint
CREATE TABLE "class_groups" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"space_id" uuid NOT NULL,
	"sport_id" uuid NOT NULL,
	"teacher_member_id" uuid NOT NULL,
	"court_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" "sport_level",
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"duration_min" integer NOT NULL,
	"capacity" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_groups_id_space_id_unique" UNIQUE("id","space_id"),
	CONSTRAINT "class_groups_weekday_range" CHECK ("class_groups"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "class_groups_duration_valid" CHECK ("class_groups"."duration_min" > 0 AND "class_groups"."duration_min" % 30 = 0),
	CONSTRAINT "class_groups_start_time_aligned" CHECK (EXTRACT(MINUTE FROM "class_groups"."start_time") IN (0, 30)),
	CONSTRAINT "class_groups_capacity_positive" CHECK ("class_groups"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "class_session_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"class_group_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"conflicts_with" "occupation_kind" NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_session_conflicts_group_starts_at_unique" UNIQUE("class_group_id","starts_at"),
	CONSTRAINT "class_session_conflicts_period_valid" CHECK ("class_session_conflicts"."ends_at" > "class_session_conflicts"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "class_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"class_group_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"court_id" uuid NOT NULL,
	"teacher_member_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"status" "class_session_status" DEFAULT 'SCHEDULED' NOT NULL,
	"opened_at" timestamp with time zone,
	"opened_by" uuid,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_sessions_class_group_starts_at_unique" UNIQUE("class_group_id","starts_at"),
	CONSTRAINT "class_sessions_period_valid" CHECK ("class_sessions"."ends_at" > "class_sessions"."starts_at"),
	CONSTRAINT "class_sessions_capacity_positive" CHECK ("class_sessions"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"class_group_id" uuid NOT NULL,
	"status" "enrollment_status" DEFAULT 'ACTIVE' NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollments_dates_valid" CHECK ("enrollments"."ended_on" IS NULL OR "enrollments"."ended_on" >= "enrollments"."started_on")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"space_id" uuid NOT NULL,
	"sport_id" uuid NOT NULL,
	"name" text NOT NULL,
	"weekly_frequency" smallint,
	"price_cents" integer NOT NULL,
	"billing_day" smallint NOT NULL,
	"pause_allowed" boolean DEFAULT true NOT NULL,
	"max_pause_days_per_year" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_id_space_id_unique" UNIQUE("id","space_id"),
	CONSTRAINT "plans_weekly_frequency_range" CHECK ("plans"."weekly_frequency" BETWEEN 1 AND 7),
	CONSTRAINT "plans_price_cents_non_negative" CHECK ("plans"."price_cents" >= 0),
	CONSTRAINT "plans_billing_day_range" CHECK ("plans"."billing_day" BETWEEN 1 AND 28),
	CONSTRAINT "plans_max_pause_days_per_year_range" CHECK ("plans"."max_pause_days_per_year" BETWEEN 0 AND 365)
);
--> statement-breakpoint
CREATE TABLE "subscription_charges" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"due_date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" charge_status DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_charges_subscription_period_unique" UNIQUE("subscription_id","period_start"),
	CONSTRAINT "subscription_charges_amount_cents_non_negative" CHECK ("subscription_charges"."amount_cents" >= 0),
	CONSTRAINT "subscription_charges_period_valid" CHECK ("subscription_charges"."period_end" >= "subscription_charges"."period_start")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"status" "subscription_status" DEFAULT 'PENDING_APPROVAL' NOT NULL,
	"price_cents" integer NOT NULL,
	"starts_on" date,
	"current_period_start" date,
	"current_period_end" date,
	"paused_from" date,
	"paused_until" date,
	"pause_days_used" integer DEFAULT 0 NOT NULL,
	"intended_payment_method" "payment_method",
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_price_cents_non_negative" CHECK ("subscriptions"."price_cents" >= 0),
	CONSTRAINT "subscriptions_pause_days_used_non_negative" CHECK ("subscriptions"."pause_days_used" >= 0),
	CONSTRAINT "subscriptions_period_valid" CHECK ("subscriptions"."current_period_end" IS NULL OR "subscriptions"."current_period_start" IS NULL OR "subscriptions"."current_period_end" >= "subscriptions"."current_period_start"),
	CONSTRAINT "subscriptions_pause_valid" CHECK ("subscriptions"."paused_until" IS NULL OR "subscriptions"."paused_from" IS NULL OR "subscriptions"."paused_until" >= "subscriptions"."paused_from")
);
--> statement-breakpoint
ALTER TABLE "space_settings" ADD COLUMN "past_due_block_enabled" boolean;--> statement-breakpoint
-- Ordem ajustada à mão: a UNIQUE (id, space_id) precisa existir antes das FKs compostas que a
-- referenciam (o drizzle-kit gera as FKs primeiro).
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_id_space_id_unique" UNIQUE("id","space_id");--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_court_space_fk" FOREIGN KEY ("court_id","space_id") REFERENCES "public"."courts"("id","space_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_teacher_space_fk" FOREIGN KEY ("teacher_member_id","space_id") REFERENCES "public"."space_members"("id","space_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_session_conflicts" ADD CONSTRAINT "class_session_conflicts_class_group_id_class_groups_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_class_group_space_fk" FOREIGN KEY ("class_group_id","space_id") REFERENCES "public"."class_groups"("id","space_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_court_space_fk" FOREIGN KEY ("court_id","space_id") REFERENCES "public"."courts"("id","space_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_teacher_space_fk" FOREIGN KEY ("teacher_member_id","space_id") REFERENCES "public"."space_members"("id","space_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_class_group_id_class_groups_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_charges" ADD CONSTRAINT "subscription_charges_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_space_fk" FOREIGN KEY ("plan_id","space_id") REFERENCES "public"."plans"("id","space_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendances_user_id_idx" ON "attendances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "attendances_session_id_status_idx" ON "attendances" USING btree ("session_id","status");--> statement-breakpoint
CREATE INDEX "class_groups_space_id_active_idx" ON "class_groups" USING btree ("space_id","active");--> statement-breakpoint
CREATE INDEX "class_groups_court_id_weekday_idx" ON "class_groups" USING btree ("court_id","weekday");--> statement-breakpoint
CREATE INDEX "class_groups_teacher_member_id_idx" ON "class_groups" USING btree ("teacher_member_id");--> statement-breakpoint
CREATE INDEX "class_groups_sport_id_idx" ON "class_groups" USING btree ("sport_id");--> statement-breakpoint
CREATE INDEX "class_session_conflicts_open_idx" ON "class_session_conflicts" USING btree ("class_group_id") WHERE "class_session_conflicts"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "class_sessions_space_id_starts_at_idx" ON "class_sessions" USING btree ("space_id","starts_at");--> statement-breakpoint
CREATE INDEX "class_sessions_teacher_member_id_starts_at_idx" ON "class_sessions" USING btree ("teacher_member_id","starts_at");--> statement-breakpoint
CREATE INDEX "class_sessions_court_id_idx" ON "class_sessions" USING btree ("court_id");--> statement-breakpoint
CREATE INDEX "class_sessions_pending_idx" ON "class_sessions" USING btree ("starts_at") WHERE "class_sessions"."status" IN ('SCHEDULED', 'OPEN', 'CLOSED');--> statement-breakpoint
CREATE INDEX "class_sessions_opened_by_idx" ON "class_sessions" USING btree ("opened_by");--> statement-breakpoint
CREATE INDEX "class_sessions_closed_by_idx" ON "class_sessions" USING btree ("closed_by");--> statement-breakpoint
CREATE INDEX "class_sessions_cancelled_by_idx" ON "class_sessions" USING btree ("cancelled_by");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_active_subscription_group_unique" ON "enrollments" USING btree ("subscription_id","class_group_id") WHERE "enrollments"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "enrollments_class_group_id_status_idx" ON "enrollments" USING btree ("class_group_id","status");--> statement-breakpoint
CREATE INDEX "enrollments_subscription_id_idx" ON "enrollments" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "plans_space_id_active_idx" ON "plans" USING btree ("space_id","active");--> statement-breakpoint
CREATE INDEX "plans_sport_id_idx" ON "plans" USING btree ("sport_id");--> statement-breakpoint
CREATE INDEX "subscription_charges_status_due_date_idx" ON "subscription_charges" USING btree ("status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_open_user_plan_unique" ON "subscriptions" USING btree ("user_id","plan_id") WHERE "subscriptions"."status" IN ('PENDING_APPROVAL', 'ACTIVE', 'PAUSED', 'PAST_DUE');--> statement-breakpoint
CREATE INDEX "subscriptions_space_id_status_idx" ON "subscriptions" USING btree ("space_id","status");--> statement-breakpoint
CREATE INDEX "subscriptions_plan_id_idx" ON "subscriptions" USING btree ("plan_id");--> statement-breakpoint
ALTER TABLE "space_settings" ADD CONSTRAINT "space_settings_past_due_block_days_range" CHECK ("space_settings"."past_due_block_days" BETWEEN 1 AND 365);--> statement-breakpoint
ALTER TABLE "space_settings" ADD CONSTRAINT "space_settings_max_pause_days_per_year_range" CHECK ("space_settings"."max_pause_days_per_year" BETWEEN 0 AND 365);
