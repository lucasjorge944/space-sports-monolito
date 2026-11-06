CREATE TYPE "public"."deletion_request_source" AS ENUM('USER', 'SUPER');--> statement-breakpoint
CREATE TYPE "public"."deletion_request_status" AS ENUM('PENDING', 'COMPLETED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "account_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "deletion_request_status" DEFAULT 'PENDING' NOT NULL,
	"source" "deletion_request_source" NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"super_user_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_super_user_id_users_id_fk" FOREIGN KEY ("super_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_deletion_requests_status_created_at_idx" ON "account_deletion_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "account_deletion_requests_resolved_by_idx" ON "account_deletion_requests" USING btree ("resolved_by");--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_requests_user_pending_unique" ON "account_deletion_requests" USING btree ("user_id") WHERE "account_deletion_requests"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "support_sessions_super_user_id_idx" ON "support_sessions" USING btree ("super_user_id");--> statement-breakpoint
CREATE INDEX "support_sessions_space_id_idx" ON "support_sessions" USING btree ("space_id");