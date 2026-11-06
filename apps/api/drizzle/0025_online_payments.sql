-- Pagamento online (decisões 80 a 96; RF-ONPAY, RN-ONPAY; docs/13-pagamentos-online.md): taxa da
-- plataforma, modos e cadastro do espaço no gateway, cobranças, estornos e chargebacks, webhooks,
-- livro-razão da carteira e repasses, abatimento do item no estorno manual, chaves de idempotência
-- do app, o documento do cadastro cifrado (decisão 97) e o namespace do gateway simulado. `PENDING_PAYMENT` entra no enum de status da reserva;
-- ele não pode aparecer em outro comando desta migração (o valor novo de um enum só vale depois do
-- commit), por isso o índice do job de expiração usa `payment_due_at`.
CREATE TYPE "public"."booking_payment_mode" AS ENUM('ON_SITE', 'ONLINE_OPTIONAL', 'ONLINE_REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."chargeback_dispute_status" AS ENUM('AWAITING_RESPONSE', 'RESPONDED', 'WON', 'LOST');--> statement-breakpoint
CREATE TYPE "public"."class_payment_mode" AS ENUM('ON_SITE', 'ONLINE_OPTIONAL');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('CPF', 'CNPJ');--> statement-breakpoint
CREATE TYPE "public"."fee_payer" AS ENUM('SPACE', 'PLAYER');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_kind" AS ENUM('SALE', 'PLATFORM_FEE', 'REFUND', 'FEE_REFUND', 'CHARGEBACK', 'PAYOUT', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."merchant_account_status" AS ENUM('NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."online_charge_status" AS ENUM('PENDING', 'PAID', 'EXPIRED', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CHARGEBACK');--> statement-breakpoint
CREATE TYPE "public"."online_payment_method" AS ENUM('PIX', 'CARD');--> statement-breakpoint
CREATE TYPE "public"."online_refund_kind" AS ENUM('REFUND', 'CHARGEBACK');--> statement-breakpoint
CREATE TYPE "public"."online_refund_reason_code" AS ENUM('MANUAL', 'BOOKING_CANCELLED_BY_PLAYER', 'BOOKING_CANCELLED_BY_SPACE', 'ACCOUNT_DELETED', 'PAID_AFTER_DEADLINE', 'PAID_AFTER_METHOD_CHANGE', 'ITEM_ALREADY_PAID', 'CHARGEBACK', 'EXTERNAL');--> statement-breakpoint
CREATE TYPE "public"."online_refund_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."payment_channel" AS ENUM('ON_SITE', 'ONLINE');--> statement-breakpoint
CREATE TYPE "public"."payout_destination_kind" AS ENUM('BANK_ACCOUNT', 'PIX_KEY');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('SCHEDULED', 'PAID', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'PENDING_PAYMENT' BEFORE 'CONFIRMED';--> statement-breakpoint
CREATE TABLE "fake_gateway_objects" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"account_id" text,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_events_provider_event_unique" UNIQUE("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "merchant_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"space_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text,
	"status" "merchant_account_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"document_type" "document_type" NOT NULL,
	"document_encrypted" text NOT NULL,
	"document_masked" text NOT NULL,
	"legal_name" text NOT NULL,
	"responsible_name" text NOT NULL,
	"email" text NOT NULL,
	"payout_kind" "payout_destination_kind" NOT NULL,
	"payout_masked" text NOT NULL,
	"rejection_reason" text,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_accounts_space_id_unique" UNIQUE("space_id"),
	CONSTRAINT "merchant_accounts_provider_account_unique" UNIQUE("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "online_charges" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"space_id" uuid NOT NULL,
	"payable_type" "payable_type" NOT NULL,
	"payable_id" uuid NOT NULL,
	"payer_user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_charge_id" text,
	"method" "online_payment_method" NOT NULL,
	"status" "online_charge_status" DEFAULT 'PENDING' NOT NULL,
	"amount_cents" integer NOT NULL,
	"service_amount_cents" integer NOT NULL,
	"platform_fee_cents" integer NOT NULL,
	"gateway_cost_cents" integer DEFAULT 0 NOT NULL,
	"space_net_cents" integer NOT NULL,
	"fee_payer" "fee_payer" NOT NULL,
	"fee_bps" integer NOT NULL,
	"min_fee_cents" integer NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"fee_refunded_cents" integer DEFAULT 0 NOT NULL,
	"pix_copy_paste" text,
	"pix_qr_svg" text,
	"card_brand" text,
	"card_last4" text,
	"expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"failure_reason" text,
	"closed_reason" text,
	"idempotency_key" text NOT NULL,
	"request_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_charges_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "online_charges_payable_type" CHECK ("online_charges"."payable_type" IN ('BOOKING', 'SUBSCRIPTION_CHARGE')),
	CONSTRAINT "online_charges_amounts_valid" CHECK ("online_charges"."amount_cents" > 0 AND "online_charges"."service_amount_cents" > 0 AND "online_charges"."platform_fee_cents" >= 0 AND "online_charges"."platform_fee_cents" <= "online_charges"."amount_cents" AND "online_charges"."gateway_cost_cents" >= 0 AND "online_charges"."space_net_cents" >= 0 AND "online_charges"."fee_bps" BETWEEN 0 AND 10000 AND "online_charges"."min_fee_cents" >= 0),
	CONSTRAINT "online_charges_split_consistent" CHECK (CASE "online_charges"."fee_payer" WHEN 'SPACE' THEN "online_charges"."amount_cents" = "online_charges"."service_amount_cents" AND "online_charges"."space_net_cents" = "online_charges"."amount_cents" - "online_charges"."platform_fee_cents" ELSE "online_charges"."amount_cents" = "online_charges"."service_amount_cents" + "online_charges"."platform_fee_cents" AND "online_charges"."space_net_cents" = "online_charges"."service_amount_cents" END),
	CONSTRAINT "online_charges_refunds_valid" CHECK ("online_charges"."refunded_cents" BETWEEN 0 AND "online_charges"."amount_cents" AND "online_charges"."fee_refunded_cents" BETWEEN 0 AND "online_charges"."platform_fee_cents")
);
--> statement-breakpoint
CREATE TABLE "online_refunds" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"charge_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"kind" "online_refund_kind" NOT NULL,
	"status" "online_refund_status" DEFAULT 'PENDING' NOT NULL,
	"amount_cents" integer NOT NULL,
	"fee_refund_cents" integer NOT NULL,
	"reason" text,
	"reason_code" "online_refund_reason_code" NOT NULL,
	"requested_by" uuid,
	"charge_again" boolean DEFAULT false NOT NULL,
	"item_discount_cents" integer DEFAULT 0 NOT NULL,
	"provider_refund_id" text,
	"applied_at" timestamp with time zone,
	"dispute_status" chargeback_dispute_status,
	"dispute_respond_by" timestamp with time zone,
	"dispute_response_text" text,
	"dispute_attachment_urls" text[] DEFAULT '{}' NOT NULL,
	"dispute_responded_at" timestamp with time zone,
	"dispute_responded_by" uuid,
	"dispute_resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_refunds_charge_provider_refund_unique" UNIQUE("charge_id","provider_refund_id"),
	CONSTRAINT "online_refunds_amounts_valid" CHECK ("online_refunds"."amount_cents" > 0 AND "online_refunds"."fee_refund_cents" >= 0 AND "online_refunds"."fee_refund_cents" <= "online_refunds"."amount_cents" AND "online_refunds"."item_discount_cents" BETWEEN 0 AND "online_refunds"."amount_cents"),
	CONSTRAINT "online_refunds_dispute_only_chargeback" CHECK (("online_refunds"."kind" = 'CHARGEBACK') = ("online_refunds"."dispute_status" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"space_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_payout_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "payout_status" NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_provider_payout_unique" UNIQUE("provider","provider_payout_id"),
	CONSTRAINT "payouts_amount_positive" CHECK ("payouts"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "platform_fee_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"pix_fee_bps" integer NOT NULL,
	"card_fee_bps" integer NOT NULL,
	"min_fee_cents" integer NOT NULL,
	"fee_payer" "fee_payer" DEFAULT 'SPACE' NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_fee_settings_single_row" CHECK ("platform_fee_settings"."id" = 1),
	CONSTRAINT "platform_fee_settings_values" CHECK ("platform_fee_settings"."pix_fee_bps" BETWEEN 0 AND 10000 AND "platform_fee_settings"."card_fee_bps" BETWEEN 0 AND 10000 AND "platform_fee_settings"."min_fee_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "space_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"space_id" uuid NOT NULL,
	"charge_id" uuid,
	"refund_id" uuid,
	"payout_id" uuid,
	"kind" "ledger_entry_kind" NOT NULL,
	"amount_cents" integer NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_ledger_entries_sign" CHECK (CASE "space_ledger_entries"."kind" WHEN 'SALE' THEN "space_ledger_entries"."amount_cents" > 0 WHEN 'FEE_REFUND' THEN "space_ledger_entries"."amount_cents" > 0 WHEN 'ADJUSTMENT' THEN "space_ledger_entries"."amount_cents" <> 0 ELSE "space_ledger_entries"."amount_cents" < 0 END)
);
--> statement-breakpoint
CREATE TABLE "space_payment_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"space_id" uuid NOT NULL,
	"booking_mode" "booking_payment_mode" DEFAULT 'ON_SITE' NOT NULL,
	"class_mode" "class_payment_mode" DEFAULT 'ON_SITE' NOT NULL,
	"pix_fee_bps" integer,
	"card_fee_bps" integer,
	"min_fee_cents" integer,
	"fee_payer" "fee_payer",
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_payment_settings_space_id_unique" UNIQUE("space_id"),
	CONSTRAINT "space_payment_settings_fee_values" CHECK (("space_payment_settings"."pix_fee_bps" IS NULL OR "space_payment_settings"."pix_fee_bps" BETWEEN 0 AND 10000) AND ("space_payment_settings"."card_fee_bps" IS NULL OR "space_payment_settings"."card_fee_bps" BETWEEN 0 AND 10000) AND ("space_payment_settings"."min_fee_cents" IS NULL OR "space_payment_settings"."min_fee_cents" >= 0))
);
--> statement-breakpoint
ALTER TABLE "payment_records" DROP CONSTRAINT "payment_records_reversal_consistent";--> statement-breakpoint
ALTER TABLE "payment_records" ALTER COLUMN "recorded_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_charges" ADD COLUMN "discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "channel" "payment_channel" DEFAULT 'ON_SITE' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "online_charge_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "payment_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "merchant_accounts" ADD CONSTRAINT "merchant_accounts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_accounts" ADD CONSTRAINT "merchant_accounts_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_charges" ADD CONSTRAINT "online_charges_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_charges" ADD CONSTRAINT "online_charges_payer_user_id_users_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_refunds" ADD CONSTRAINT "online_refunds_charge_id_online_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."online_charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_refunds" ADD CONSTRAINT "online_refunds_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_refunds" ADD CONSTRAINT "online_refunds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_refunds" ADD CONSTRAINT "online_refunds_dispute_responded_by_users_id_fk" FOREIGN KEY ("dispute_responded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_fee_settings" ADD CONSTRAINT "platform_fee_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_ledger_entries" ADD CONSTRAINT "space_ledger_entries_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_ledger_entries" ADD CONSTRAINT "space_ledger_entries_charge_id_online_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."online_charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_ledger_entries" ADD CONSTRAINT "space_ledger_entries_refund_id_online_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."online_refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_ledger_entries" ADD CONSTRAINT "space_ledger_entries_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_payment_settings" ADD CONSTRAINT "space_payment_settings_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_payment_settings" ADD CONSTRAINT "space_payment_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fake_gateway_objects_kind_account_idx" ON "fake_gateway_objects" USING btree ("kind","account_id");--> statement-breakpoint
CREATE INDEX "gateway_events_unprocessed_idx" ON "gateway_events" USING btree ("received_at") WHERE "gateway_events"."processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "merchant_accounts_status_idx" ON "merchant_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "merchant_accounts_submitted_by_idx" ON "merchant_accounts" USING btree ("submitted_by");--> statement-breakpoint
CREATE UNIQUE INDEX "online_charges_provider_charge_unique" ON "online_charges" USING btree ("provider","provider_charge_id") WHERE "online_charges"."provider_charge_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "online_charges_one_pending_per_item" ON "online_charges" USING btree ("payable_type","payable_id") WHERE "online_charges"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "online_charges_payable_idx" ON "online_charges" USING btree ("payable_type","payable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "online_charges_payer_request_key_unique" ON "online_charges" USING btree ("payer_user_id","request_key") WHERE "online_charges"."request_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "online_charges_space_id_created_at_idx" ON "online_charges" USING btree ("space_id","created_at");--> statement-breakpoint
CREATE INDEX "online_charges_payer_user_id_id_idx" ON "online_charges" USING btree ("payer_user_id","id");--> statement-breakpoint
CREATE INDEX "online_charges_pending_expires_at_idx" ON "online_charges" USING btree ("expires_at") WHERE "online_charges"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "online_refunds_charge_id_idx" ON "online_refunds" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "online_refunds_space_id_kind_idx" ON "online_refunds" USING btree ("space_id","kind");--> statement-breakpoint
CREATE INDEX "online_refunds_requested_by_idx" ON "online_refunds" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "online_refunds_dispute_responded_by_idx" ON "online_refunds" USING btree ("dispute_responded_by");--> statement-breakpoint
CREATE INDEX "payouts_space_id_created_at_idx" ON "payouts" USING btree ("space_id","created_at");--> statement-breakpoint
CREATE INDEX "space_ledger_entries_space_id_id_idx" ON "space_ledger_entries" USING btree ("space_id","id");--> statement-breakpoint
CREATE INDEX "space_ledger_entries_space_id_available_at_idx" ON "space_ledger_entries" USING btree ("space_id","available_at");--> statement-breakpoint
CREATE INDEX "space_ledger_entries_charge_id_idx" ON "space_ledger_entries" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "space_ledger_entries_refund_id_idx" ON "space_ledger_entries" USING btree ("refund_id");--> statement-breakpoint
CREATE INDEX "space_ledger_entries_payout_id_idx" ON "space_ledger_entries" USING btree ("payout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "space_ledger_entries_charge_kind_unique" ON "space_ledger_entries" USING btree ("charge_id","kind") WHERE "space_ledger_entries"."refund_id" IS NULL AND "space_ledger_entries"."payout_id" IS NULL AND "space_ledger_entries"."charge_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "space_ledger_entries_refund_kind_unique" ON "space_ledger_entries" USING btree ("refund_id","kind") WHERE "space_ledger_entries"."refund_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "space_ledger_entries_payout_kind_unique" ON "space_ledger_entries" USING btree ("payout_id","kind") WHERE "space_ledger_entries"."payout_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_online_charge_id_online_charges_id_fk" FOREIGN KEY ("online_charge_id") REFERENCES "public"."online_charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_records_online_charge_id_idx" ON "payment_records" USING btree ("online_charge_id");--> statement-breakpoint
CREATE INDEX "bookings_payment_due_at_idx" ON "bookings" USING btree ("payment_due_at") WHERE "bookings"."payment_due_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_organizer_idempotency_key_unique" ON "bookings" USING btree ("organizer_user_id","idempotency_key") WHERE "bookings"."idempotency_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_charges" ADD CONSTRAINT "subscription_charges_discount_valid" CHECK ("subscription_charges"."discount_cents" BETWEEN 0 AND "subscription_charges"."amount_cents");--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_channel_consistent" CHECK (CASE "payment_records"."channel" WHEN 'ON_SITE' THEN "payment_records"."recorded_by" IS NOT NULL AND "payment_records"."online_charge_id" IS NULL ELSE "payment_records"."online_charge_id" IS NOT NULL AND "payment_records"."recorded_by" IS NULL END);--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_reversal_consistent" CHECK ("payment_records"."reversed_by" IS NULL OR "payment_records"."reversed_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_discount_valid" CHECK ("bookings"."discount_cents" BETWEEN 0 AND "bookings"."price_cents");--> statement-breakpoint
-- Decisão 83: Pix 4%, cartão 6%, mínimo R$ 1,00, pagos pelo espaço; editável no /super.
INSERT INTO "platform_fee_settings" ("id", "pix_fee_bps", "card_fee_bps", "min_fee_cents", "fee_payer") VALUES (1, 400, 600, 100, 'SPACE');
