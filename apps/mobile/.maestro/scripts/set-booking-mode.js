// Troca o modo de pagamento das reservas do espaço (RF-ONPAY-02) pelo Dono, mantendo o das aulas.
// Env: API_URL, API_TOKEN (do Dono, via payments-login.js), SPACE_SLUG e BOOKING_MODE
// (`ON_SITE`, `ONLINE_OPTIONAL` ou `ONLINE_REQUIRED`).
var space = http.get(`${API_URL}/v1/spaces/${SPACE_SLUG}`);
if (space.status >= 400) throw new Error(`Espaço ${SPACE_SLUG} não encontrado (${space.status})`);
var spaceId = json(space.body).id;
var auth = { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' };
var url = `${API_URL}/v1/manage/spaces/${spaceId}/online-payments/settings`;
var current = http.get(url, { headers: auth });
if (current.status >= 400)
  throw new Error(`Configurações indisponíveis (${current.status}): ${current.body}`);
var updated = http.put(url, {
  headers: auth,
  body: JSON.stringify({ bookingMode: BOOKING_MODE, classMode: json(current.body).classMode }),
});
if (updated.status >= 400) throw new Error(`Modo não salvo (${updated.status}): ${updated.body}`);
