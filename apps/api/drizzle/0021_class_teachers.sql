-- Decisão 47: turmas e aulas têm um ou mais professores, e o mesmo professor não dá aulas
-- sobrepostas em espaços diferentes.
CREATE TYPE "public"."class_conflict_kind" AS ENUM('BOOKING', 'CLASS', 'TOURNAMENT', 'BLOCK', 'TEACHER');--> statement-breakpoint
CREATE TABLE "class_group_teachers" (
	"class_group_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"teacher_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_group_teachers_class_group_id_teacher_member_id_pk" PRIMARY KEY("class_group_id","teacher_member_id")
);
--> statement-breakpoint
CREATE TABLE "class_session_teachers" (
	"class_session_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"teacher_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_session_teachers_class_session_id_teacher_member_id_pk" PRIMARY KEY("class_session_id","teacher_member_id")
);
--> statement-breakpoint
CREATE TABLE "teacher_occupations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"class_session_id" uuid NOT NULL,
	"period" "tstzrange" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_occupations_class_session_user_unique" UNIQUE("class_session_id","user_id"),
	CONSTRAINT "teacher_occupations_period_valid" CHECK (NOT isempty("teacher_occupations"."period") AND NOT lower_inf("teacher_occupations"."period") AND NOT upper_inf("teacher_occupations"."period") AND lower_inc("teacher_occupations"."period") AND NOT upper_inc("teacher_occupations"."period"))
);
--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_id_space_id_unique" UNIQUE("id","space_id");--> statement-breakpoint
ALTER TABLE "class_group_teachers" ADD CONSTRAINT "class_group_teachers_class_group_space_fk" FOREIGN KEY ("class_group_id","space_id") REFERENCES "public"."class_groups"("id","space_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_group_teachers" ADD CONSTRAINT "class_group_teachers_member_space_fk" FOREIGN KEY ("teacher_member_id","space_id") REFERENCES "public"."space_members"("id","space_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_session_teachers" ADD CONSTRAINT "class_session_teachers_class_session_space_fk" FOREIGN KEY ("class_session_id","space_id") REFERENCES "public"."class_sessions"("id","space_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_session_teachers" ADD CONSTRAINT "class_session_teachers_member_space_fk" FOREIGN KEY ("teacher_member_id","space_id") REFERENCES "public"."space_members"("id","space_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_occupations" ADD CONSTRAINT "teacher_occupations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_occupations" ADD CONSTRAINT "teacher_occupations_class_session_space_fk" FOREIGN KEY ("class_session_id","space_id") REFERENCES "public"."class_sessions"("id","space_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_group_teachers_teacher_member_id_idx" ON "class_group_teachers" USING btree ("teacher_member_id");--> statement-breakpoint
CREATE INDEX "class_session_teachers_teacher_member_id_idx" ON "class_session_teachers" USING btree ("teacher_member_id");--> statement-breakpoint
CREATE INDEX "teacher_occupations_user_id_idx" ON "teacher_occupations" USING btree ("user_id");--> statement-breakpoint
-- Tipo próprio para o aviso à gestão: `occupation_kind` continua só com o que ocupa uma quadra.
ALTER TABLE "class_session_conflicts" ALTER COLUMN "conflicts_with" SET DATA TYPE "public"."class_conflict_kind" USING "conflicts_with"::text::"public"."class_conflict_kind";--> statement-breakpoint
-- A lista nasce com o professor atual de cada turma e aula.
INSERT INTO "class_group_teachers" ("class_group_id", "space_id", "teacher_member_id")
SELECT "id", "space_id", "teacher_member_id" FROM "class_groups";--> statement-breakpoint
INSERT INTO "class_session_teachers" ("class_session_id", "space_id", "teacher_member_id")
SELECT "id", "space_id", "teacher_member_id" FROM "class_sessions";--> statement-breakpoint
ALTER TABLE "class_groups" DROP CONSTRAINT "class_groups_teacher_space_fk";--> statement-breakpoint
ALTER TABLE "class_sessions" DROP CONSTRAINT "class_sessions_teacher_space_fk";--> statement-breakpoint
DROP INDEX "class_groups_teacher_member_id_idx";--> statement-breakpoint
DROP INDEX "class_sessions_teacher_member_id_starts_at_idx";--> statement-breakpoint
ALTER TABLE "class_groups" DROP COLUMN "teacher_member_id";--> statement-breakpoint
ALTER TABLE "class_sessions" DROP COLUMN "teacher_member_id";--> statement-breakpoint
-- Mesmo professor (usuário) com aulas ativas sobrepostas só no mesmo espaço. O Drizzle não modela
-- EXCLUDE; por isso esta parte é escrita à mão. `<>` em uuid vem do btree_gist.
ALTER TABLE "teacher_occupations"
  ADD CONSTRAINT "teacher_occupations_no_overlap"
  EXCLUDE USING gist ("user_id" WITH =, "period" WITH &&, "space_id" WITH <>) WHERE ("active");--> statement-breakpoint
-- Antes não havia essa regra: uma sobreposição entre espaços pode já existir e não pode travar a
-- migração. A aula mais antiga fica com a ocupação ativa; a outra entra inativa (abaixo), segue
-- como está e a gestão resolve. `ON CONFLICT DO NOTHING` também vale para a constraint de exclusão.
INSERT INTO "teacher_occupations" ("user_id", "space_id", "class_session_id", "period")
SELECT sm."user_id", cs."space_id", cs."id", tstzrange(cs."starts_at", cs."ends_at", '[)')
FROM "class_session_teachers" cst
INNER JOIN "class_sessions" cs ON cs."id" = cst."class_session_id"
INNER JOIN "space_members" sm ON sm."id" = cst."teacher_member_id"
WHERE cs."status" <> 'CANCELLED'
ORDER BY cs."starts_at", cs."id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Aulas canceladas não contam, e as que ficaram de fora acima seguem sem segurar o horário.
INSERT INTO "teacher_occupations" ("user_id", "space_id", "class_session_id", "period", "active")
SELECT sm."user_id", cs."space_id", cs."id", tstzrange(cs."starts_at", cs."ends_at", '[)'), false
FROM "class_session_teachers" cst
INNER JOIN "class_sessions" cs ON cs."id" = cst."class_session_id"
INNER JOIN "space_members" sm ON sm."id" = cst."teacher_member_id"
ON CONFLICT ("class_session_id", "user_id") DO NOTHING;--> statement-breakpoint
-- Ao menos um professor: `NOT NULL` não alcança uma tabela de relação, então o gatilho confere no
-- fim da transação, depois que a turma ou a aula e a lista já foram gravadas.
CREATE FUNCTION "class_group_requires_teacher"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid := CASE TG_TABLE_NAME
    WHEN 'class_groups' THEN (to_jsonb(NEW) ->> 'id')::uuid
    ELSE (to_jsonb(OLD) ->> 'class_group_id')::uuid
  END;
BEGIN
  IF EXISTS (SELECT 1 FROM "class_groups" WHERE "id" = target)
    AND NOT EXISTS (SELECT 1 FROM "class_group_teachers" WHERE "class_group_id" = target) THEN
    RAISE EXCEPTION 'A turma % ficaria sem professor.', target
      USING ERRCODE = 'check_violation', CONSTRAINT = 'class_group_teachers_required';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "class_session_requires_teacher"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid := CASE TG_TABLE_NAME
    WHEN 'class_sessions' THEN (to_jsonb(NEW) ->> 'id')::uuid
    ELSE (to_jsonb(OLD) ->> 'class_session_id')::uuid
  END;
BEGIN
  IF EXISTS (SELECT 1 FROM "class_sessions" WHERE "id" = target)
    AND NOT EXISTS (SELECT 1 FROM "class_session_teachers" WHERE "class_session_id" = target) THEN
    RAISE EXCEPTION 'A aula % ficaria sem professor.', target
      USING ERRCODE = 'check_violation', CONSTRAINT = 'class_session_teachers_required';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "class_groups_require_teacher" AFTER INSERT ON "class_groups"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "class_group_requires_teacher"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "class_group_teachers_keep_one" AFTER DELETE ON "class_group_teachers"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "class_group_requires_teacher"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "class_sessions_require_teacher" AFTER INSERT ON "class_sessions"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "class_session_requires_teacher"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "class_session_teachers_keep_one" AFTER DELETE ON "class_session_teachers"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "class_session_requires_teacher"();
