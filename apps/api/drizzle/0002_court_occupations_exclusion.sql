-- RN-BOOK-03: duas ocupações ativas da mesma quadra não podem se sobrepor. Garantido no banco,
-- à prova de concorrência. Períodos são `[início, fim)`, então horários adjacentes não conflitam.
-- O Drizzle não modela EXCLUDE; por isso esta migração é escrita à mão.
ALTER TABLE "court_occupations"
  ADD CONSTRAINT "court_occupations_no_overlap"
  EXCLUDE USING gist ("court_id" WITH =, "period" WITH &&) WHERE ("active");
