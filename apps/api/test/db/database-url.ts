/** Banco migrado que cada arquivo de teste clona. */
export const TEMPLATE_DB = 'space_sports_template';

export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}
