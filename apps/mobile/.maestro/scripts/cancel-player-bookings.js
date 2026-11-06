// Limpeza dos fluxos de pagamento: cancela pela API as reservas futuras ainda ativas do jogador no
// espaço (aguardando pagamento ou confirmadas), para o fluxo poder rodar de novo no mesmo horário.
// No seed, o jogador dos fluxos (`jogador.e2e`) não tem reservas próprias na Arena E2E Norte (as de
// demonstração são de outro jogador). Env: API_URL, API_TOKEN (do jogador, via payments-login.js)
// e SPACE_SLUG.
var auth = { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' };
var list = http.get(`${API_URL}/v1/bookings?when=upcoming&limit=50`, { headers: auth });
if (list.status >= 400) throw new Error(`Reservas indisponíveis (${list.status}): ${list.body}`);
json(list.body)
  .items.filter(
    (b) =>
      b.space.slug === SPACE_SLUG && (b.status === 'CONFIRMED' || b.status === 'PENDING_PAYMENT'),
  )
  .forEach((b) => {
    http.post(`${API_URL}/v1/bookings/${b.id}/cancel`, { headers: auth, body: '{}' });
  });
