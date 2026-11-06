-- A exclusão de conta é só do Super: sai o aviso CUSTOMER_ACCOUNT_DELETED à gestão dos espaços.
-- `type` é texto (sem enum no banco); apagam-se as notificações e as preferências desse tipo.
DELETE FROM "notifications" WHERE "type" = 'CUSTOMER_ACCOUNT_DELETED';--> statement-breakpoint
DELETE FROM "notification_preferences" WHERE "type" = 'CUSTOMER_ACCOUNT_DELETED';
