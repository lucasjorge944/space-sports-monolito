ALTER TABLE "online_charges" ADD COLUMN "request_hash" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "idempotency_request_hash" text;