-- A quadra de uma reserva/mensalista tem de pertencer ao mesmo espaço do registro.
-- Ordem ajustada à mão: a UNIQUE (id, space_id) precisa existir antes das FKs que a referenciam
-- (o drizzle-kit gera as FKs primeiro).
ALTER TABLE "courts" ADD CONSTRAINT "courts_id_space_id_unique" UNIQUE("id","space_id");--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_court_id_courts_id_fk";
--> statement-breakpoint
ALTER TABLE "recurring_bookings" DROP CONSTRAINT "recurring_bookings_court_id_courts_id_fk";
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_court_space_fk" FOREIGN KEY ("court_id","space_id") REFERENCES "public"."courts"("id","space_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_bookings" ADD CONSTRAINT "recurring_bookings_court_space_fk" FOREIGN KEY ("court_id","space_id") REFERENCES "public"."courts"("id","space_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A duração gravada tem de bater com o período da reserva.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_duration_matches_period" CHECK ("bookings"."duration_min" * interval '1 minute' = "bookings"."ends_at" - "bookings"."starts_at");
