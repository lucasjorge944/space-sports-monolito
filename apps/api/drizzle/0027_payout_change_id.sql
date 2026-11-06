ALTER TABLE "merchant_accounts" ADD COLUMN "payout_change_id" uuid;--> statement-breakpoint
ALTER TABLE "merchant_accounts" DROP COLUMN "responsible_cpf_encrypted";