-- RF-AUTH-03 (decisão 29): conta inativada pelo próprio titular no app; reativação pelo Super.
ALTER TYPE "public"."user_status" ADD VALUE 'INACTIVE';
