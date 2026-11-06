// Data de amanhã (America/Sao_Paulo, UTC-3, sem horário de verão) no formato `YYYY-MM-DD`,
// igual ao `d` de bookingDates (lib/datetime.ts): vira o sufixo do testID `reservar-data-<data>`.
var d = new Date(Date.now() - 3 * 3600 * 1000 + 24 * 3600 * 1000);
output.TOMORROW_DATE = d.toISOString().slice(0, 10);
