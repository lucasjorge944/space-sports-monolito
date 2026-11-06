/**
 * Sonda do contêiner (HEALTHCHECK de apps/web/Dockerfile): diz só que o servidor do Next responde.
 * Não consulta a API: uma API fora do ar não deve fazer o web parecer doente.
 */
export function GET() {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
