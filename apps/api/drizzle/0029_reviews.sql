CREATE TYPE "public"."review_author_kind" AS ENUM('PLAYER', 'STUDENT');--> statement-breakpoint
CREATE TYPE "public"."review_prompt_source" AS ENUM('BOOKING', 'CLASS_SESSION');--> statement-breakpoint
CREATE TYPE "public"."review_report_reason" AS ENUM('SPAM', 'OFFENSIVE', 'FALSE_INFO', 'PERSONAL_DATA', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."review_report_status" AS ENUM('OPEN', 'RESOLVED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."review_tag" AS ENUM('GOOD_COURT', 'BAD_COURT', 'GOOD_SERVICE', 'BAD_SERVICE', 'CLEAN', 'DIRTY', 'GOOD_VALUE', 'EXPENSIVE', 'EASY_BOOKING', 'HARD_BOOKING', 'GOOD_LIGHTING', 'BAD_LIGHTING', 'ON_TIME', 'DELAYS', 'GOOD_FACILITIES', 'POOR_FACILITIES');--> statement-breakpoint
CREATE TABLE "review_created_notices" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_created_notices_user_space_unique" UNIQUE("user_id","space_id")
);
--> statement-breakpoint
CREATE TABLE "review_prompts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"source_type" "review_prompt_source" NOT NULL,
	"source_id" uuid NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"notification_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_prompts_user_source_unique" UNIQUE("user_id","source_type","source_id")
);
--> statement-breakpoint
CREATE TABLE "space_review_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"review_id" uuid NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"reporter_space_id" uuid,
	"reason" "review_report_reason" NOT NULL,
	"details" text,
	"status" "review_report_status" DEFAULT 'OPEN' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_review_reports_review_reporter_unique" UNIQUE("review_id","reporter_user_id"),
	CONSTRAINT "space_review_reports_details_length" CHECK (char_length("space_review_reports"."details") <= 500)
);
--> statement-breakpoint
CREATE TABLE "space_reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"space_id" uuid NOT NULL,
	"user_id" uuid,
	"rating" smallint NOT NULL,
	"tags" "review_tag"[] DEFAULT '{}' NOT NULL,
	"comment" text,
	"author_kind" "review_author_kind" NOT NULL,
	"counted" boolean DEFAULT true NOT NULL,
	"comment_hidden_at" timestamp with time zone,
	"comment_hidden_by" uuid,
	"comment_hidden_reason" text,
	"reply" text,
	"reply_by" uuid,
	"replied_at" timestamp with time zone,
	"reply_updated_at" timestamp with time zone,
	"reply_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_reviews_rating_range" CHECK ("space_reviews"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "space_reviews_tags_max" CHECK (cardinality("space_reviews"."tags") <= 5),
	CONSTRAINT "space_reviews_comment_length" CHECK (char_length("space_reviews"."comment") <= 500),
	CONSTRAINT "space_reviews_reply_length" CHECK (char_length("space_reviews"."reply") <= 500),
	CONSTRAINT "space_reviews_reply_consistent" CHECK (("space_reviews"."reply" IS NULL) = ("space_reviews"."replied_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "rating_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "rating_sum" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_created_notices" ADD CONSTRAINT "review_created_notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_created_notices" ADD CONSTRAINT "review_created_notices_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_prompts" ADD CONSTRAINT "review_prompts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_prompts" ADD CONSTRAINT "review_prompts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_prompts" ADD CONSTRAINT "review_prompts_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_review_reports" ADD CONSTRAINT "space_review_reports_review_id_space_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."space_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_review_reports" ADD CONSTRAINT "space_review_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_review_reports" ADD CONSTRAINT "space_review_reports_reporter_space_id_spaces_id_fk" FOREIGN KEY ("reporter_space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_review_reports" ADD CONSTRAINT "space_review_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_reviews" ADD CONSTRAINT "space_reviews_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_reviews" ADD CONSTRAINT "space_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_reviews" ADD CONSTRAINT "space_reviews_comment_hidden_by_users_id_fk" FOREIGN KEY ("comment_hidden_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_reviews" ADD CONSTRAINT "space_reviews_reply_by_users_id_fk" FOREIGN KEY ("reply_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_prompts_user_id_space_id_sent_at_idx" ON "review_prompts" USING btree ("user_id","space_id","sent_at");--> statement-breakpoint
CREATE INDEX "space_review_reports_status_created_at_idx" ON "space_review_reports" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "space_review_reports_reporter_user_id_idx" ON "space_review_reports" USING btree ("reporter_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "space_reviews_space_user_unique" ON "space_reviews" USING btree ("space_id","user_id") WHERE "space_reviews"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "space_reviews_space_id_created_at_idx" ON "space_reviews" USING btree ("space_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "space_reviews_user_id_idx" ON "space_reviews" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "class_sessions_ends_at_idx" ON "class_sessions" USING btree ("ends_at") WHERE "class_sessions"."status" <> 'CANCELLED';--> statement-breakpoint
CREATE INDEX "bookings_ends_at_reviewable_idx" ON "bookings" USING btree ("ends_at") WHERE "bookings"."status" IN ('CONFIRMED', 'COMPLETED');--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_rating_consistent" CHECK ("spaces"."rating_count" >= 0 AND "spaces"."rating_sum" BETWEEN "spaces"."rating_count" AND 5 * "spaces"."rating_count");