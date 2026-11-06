// Paga pelo simulador do Super (RF-ONPAY-12, só com PAYMENTS_PROVIDER=fake) o Pix pendente mais
// recente do jogador: o mesmo que o app mostra na tela do Pix. Env: API_URL, API_TOKEN (de um
// Super, via payments-login.js) e PAYER_NAME (nome do jogador no seed).
var auth = { Authorization: `Bearer ${API_TOKEN}` };
var list = http.get(
  `${API_URL}/v1/super/online-payments/simulator/charges?status=PENDING&limit=100`,
  {
    headers: auth,
  },
);
if (list.status >= 400) throw new Error(`Simulador indisponível (${list.status}): ${list.body}`);
var charges = json(list.body).items.filter(
  (c) => c.method === 'PIX' && c.payer && c.payer.name === PAYER_NAME,
);
if (charges.length === 0) throw new Error(`Nenhum Pix pendente de ${PAYER_NAME}`);
charges.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
var paid = http.post(`${API_URL}/v1/super/online-payments/simulator/charges/${charges[0].id}/pay`, {
  headers: auth,
});
if (paid.status >= 400) throw new Error(`Pagamento simulado falhou (${paid.status}): ${paid.body}`);
output.PAID_CHARGE_ID = charges[0].id;
