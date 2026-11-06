// Estorno manual pela gestão (RF-ONPAY-08, RN-ONPAY-05; Dono ou Admin) da cobrança paga mais
// recente do jogador no espaço. Env: API_URL, API_TOKEN (do Dono, via payments-login.js),
// SPACE_SLUG, PAYER_NAME, AMOUNT_CENTS (número, ou `ALL` para o reembolsável inteiro), REASON e
// CHARGE_AGAIN (`true`: o valor volta a ficar em aberto; `false`: vira abatimento, decisão 93).
// Devolve o id da cobrança em `output.REFUNDED_CHARGE_ID`.
var space = http.get(`${API_URL}/v1/spaces/${SPACE_SLUG}`);
if (space.status >= 400) throw new Error(`Espaço ${SPACE_SLUG} não encontrado (${space.status})`);
var base = `${API_URL}/v1/manage/spaces/${json(space.body).id}/online-payments/charges`;
var auth = { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' };
var list = http.get(`${base}?status=PAID&status=PARTIALLY_REFUNDED&limit=100`, { headers: auth });
if (list.status >= 400) throw new Error(`Cobranças indisponíveis (${list.status}): ${list.body}`);
var charges = json(list.body).items.filter(
  (c) => c.payer && c.payer.name === PAYER_NAME && c.refundableCents > 0,
);
if (charges.length === 0) throw new Error(`Nenhuma cobrança paga de ${PAYER_NAME}`);
charges.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
var charge = charges[0];
// O valor é sempre explícito (PG.2b): "tudo" é o reembolsável que a API mostrou.
var amount = AMOUNT_CENTS === 'ALL' ? charge.refundableCents : Number(AMOUNT_CENTS);
var refund = http.post(`${base}/${charge.id}/refunds`, {
  headers: auth,
  body: JSON.stringify({
    amountCents: amount,
    reason: REASON,
    chargeAgain: CHARGE_AGAIN === 'true',
  }),
});
if (refund.status >= 400) throw new Error(`Estorno falhou (${refund.status}): ${refund.body}`);
output.REFUNDED_CHARGE_ID = charge.id;

// O estorno passa pelo gateway: espera o valor aparecer como estornado na cobrança (até ~30 s;
// ~1 s entre as consultas, o runScript não tem `setTimeout`).
function refundDone() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const current = http.get(`${base}/${charge.id}`, { headers: auth });
    if (current.status < 400 && json(current.body).refundedCents >= charge.refundedCents + amount) {
      return true;
    }
    const until = Date.now() + 1000;
    while (Date.now() < until) {}
  }
  return false;
}
if (!refundDone()) throw new Error('O estorno não foi concluído a tempo');
