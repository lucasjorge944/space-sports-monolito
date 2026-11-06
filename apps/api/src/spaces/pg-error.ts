/** Erro do Postgres por trás do erro do Drizzle (que embrulha o original em `cause`). */
export function pgErrorOf(
  err: unknown,
): { code: string; constraint?: string; table?: string } | null {
  let current: unknown = err;
  while (current && typeof current === 'object') {
    if ('code' in current && typeof current.code === 'string' && 'severity' in current) {
      return current as { code: string; constraint?: string; table?: string };
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return null;
}
