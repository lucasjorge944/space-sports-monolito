-- RF-AUTH-03 (decisão 40): exclusão por pedido do titular. CANCELLED = desistência pelo
-- atendimento (a conta é reativada); `reason` = motivo informado pelo titular.
ALTER TYPE "public"."deletion_request_status" ADD VALUE 'CANCELLED';--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD COLUMN "reason" text;
