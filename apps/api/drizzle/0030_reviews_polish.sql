ALTER TABLE "review_prompts" ADD COLUMN "answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "space_review_reports" ADD COLUMN "resolution_reason" text;--> statement-breakpoint
ALTER TABLE "space_review_reports" ADD CONSTRAINT "space_review_reports_resolution_reason_length" CHECK (char_length("space_review_reports"."resolution_reason") <= 500);--> statement-breakpoint
-- BUG-AV5-2 (RN-REVIEW-02): marca como respondidos os pedidos já gravados cuja avaliação ainda
-- existe e foi criada até 7 dias depois do pedido. Os respondidos com a avaliação já excluída não
-- têm como ser recuperados e seguem contando como ignorados.
UPDATE "review_prompts" AS p
SET "answered_at" = r."created_at"
FROM "space_reviews" AS r
WHERE r."user_id" = p."user_id"
  AND r."space_id" = p."space_id"
  AND r."created_at" >= p."sent_at"
  AND r."created_at" < p."sent_at" + interval '7 days';
