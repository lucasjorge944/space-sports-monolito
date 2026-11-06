// Avaliações (RF-REVIEW-02): acha a reserva passada do jogador no espaço (confirmada ou concluída,
// terminada há até 6 meses), que mostra o card "Avalie sua experiência". O id sai em
// `output.PAST_BOOKING_ID`. Env: API_URL, API_TOKEN (do jogador, via payments-login.js), SPACE_SLUG.
// O seed de teste precisa ter essa reserva (veja o README desta pasta).
var auth = { Authorization: `Bearer ${API_TOKEN}` };
var list = http.get(`${API_URL}/v1/bookings?when=past&limit=50`, { headers: auth });
if (list.status >= 400) throw new Error(`Reservas indisponíveis (${list.status}): ${list.body}`);
var limit = Date.now() - 180 * 24 * 60 * 60 * 1000;
var found = json(list.body).items.filter(
  (b) =>
    b.space.slug === SPACE_SLUG &&
    (b.status === 'CONFIRMED' || b.status === 'COMPLETED') &&
    new Date(b.endsAt).getTime() < Date.now() &&
    new Date(b.endsAt).getTime() > limit,
)[0];
if (!found)
  throw new Error(`Sem reserva passada do jogador em ${SPACE_SLUG}: rode o seed de teste.`);
output.PAST_BOOKING_ID = found.id;
