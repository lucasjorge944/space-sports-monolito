ALTER TABLE "merchant_accounts" ADD COLUMN "responsible_cpf_encrypted" text;--> statement-breakpoint
ALTER TABLE "merchant_accounts" ADD COLUMN "responsible_cpf_masked" text;--> statement-breakpoint
ALTER TABLE "merchant_accounts" ADD COLUMN "previous_payout_kind" "payout_destination_kind";--> statement-breakpoint
ALTER TABLE "merchant_accounts" ADD COLUMN "previous_payout_masked" text;--> statement-breakpoint
ALTER TABLE "merchant_accounts" ADD COLUMN "rejected_payout_masked" text;--> statement-breakpoint
ALTER TABLE "merchant_accounts" ADD COLUMN "payout_change_rejection_reason" text;--> statement-breakpoint
ALTER TABLE "merchant_accounts" ADD COLUMN "payout_change_rejected_at" timestamp with time zone;