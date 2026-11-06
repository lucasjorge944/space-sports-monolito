// Avaliações: apaga pela API a avaliação do jogador no espaço (204 ou 404 sem avaliação), para o
// fluxo partir do zero e poder ser repetido. Env: API_URL, API_TOKEN (do jogador), SPACE_SLUG.
var auth = { Authorization: `Bearer ${API_TOKEN}` };
var space = http.get(`${API_URL}/v1/spaces/${SPACE_SLUG}`, { headers: auth });
if (space.status >= 400) throw new Error(`Espaço indisponível (${space.status}): ${space.body}`);
var removed = http.delete(`${API_URL}/v1/spaces/${json(space.body).id}/reviews/me`, {
  headers: auth,
});
if (removed.status >= 400 && removed.status !== 404) {
  throw new Error(`Não deu para apagar a avaliação (${removed.status}): ${removed.body}`);
}
