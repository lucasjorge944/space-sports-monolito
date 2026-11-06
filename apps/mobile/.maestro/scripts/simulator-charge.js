// Ação do simulador do Super (RF-ONPAY-12, só com PAYMENTS_PROVIDER=fake) na cobrança mais recente
// do jogador com o status e o meio pedidos: `pay` (pagar o Pix), `expire` (vencer) ou `chargeback`
// (contestar no cartão). Env: API_URL, API_TOKEN (de um Super, via payments-login.js), PAYER_NAME
// (nome do jogador no seed), STATUS (`PENDING` ou `PAID`), METHOD (`PIX` ou `CARD`) e ACTION.
// Com WAIT_STATUS (ex.: `CHARGEBACK`, `EXPIRED`), espera a API aplicar o resultado (o webhook do
// fake passa pela fila), até ~30 s. Devolve o id em `output.SIMULATED_CHARGE_ID`.
var auth = { Authorization: `Bearer ${API_TOKEN}` };
var list = http.get(
  `${API_URL}/v1/super/online-payments/simulator/charges?status=${STATUS}&limit=100`,
  { headers: auth },
);
if (list.status >= 400) throw new Error(`Simulador indisponível (${list.status}): ${list.body}`);
var charges = json(list.body).items.filter(
  (c) => c.method === METHOD && c.payer && c.payer.name === PAYER_NAME,
);
if (charges.length === 0) throw new Error(`Nenhuma cobrança ${METHOD} ${STATUS} de ${PAYER_NAME}`);
charges.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
var done = http.post(
  `${API_URL}/v1/super/online-payments/simulator/charges/${charges[0].id}/${ACTION}`,
  { headers: auth },
);
if (done.status >= 400)
  throw new Error(`Simulador (${ACTION}) falhou (${done.status}): ${done.body}`);
output.SIMULATED_CHARGE_ID = charges[0].id;

// O resultado chega pela fila: consulta até a cobrança aparecer com o status esperado (~1 s entre
// as consultas; o runScript não tem `setTimeout`).
function reachedStatus(status, chargeId) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const page = http.get(
      `${API_URL}/v1/super/online-payments/simulator/charges?status=${status}&limit=100`,
      { headers: auth },
    );
    if (page.status < 400 && json(page.body).items.some((c) => c.id === chargeId)) return true;
    const until = Date.now() + 1000;
    while (Date.now() < until) {}
  }
  return false;
}
if (typeof WAIT_STATUS !== 'undefined' && WAIT_STATUS) {
  if (!reachedStatus(WAIT_STATUS, charges[0].id)) {
    throw new Error(`A cobrança não chegou a ${WAIT_STATUS}`);
  }
}
