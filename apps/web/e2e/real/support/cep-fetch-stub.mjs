// Carregado na API do e2e com `node --import` (NODE_OPTIONS do playwright.real.config.ts): troca o
// `fetch` global só para ViaCEP e BrasilAPI, para o teste de CEP (RF-SPACE, decisão 52) não depender
// de rede, de cache velho no Redis nem da disponibilidade dos provedores. Qualquer outra URL passa
// direto. O comportamento vem dos TRÊS últimos dígitos do CEP; a execução usa um prefixo novo a cada
// vez (o cache de 30 dias do Redis é por CEP completo).
//
//   111  ViaCEP responde (logradouro "Rua ViaCEP")
//   222  ViaCEP fora do ar (503) e BrasilAPI responde ("Rua BrasilAPI"); vale também para qualquer outro final
//   333  ViaCEP responde 200 com corpo inválido (cai para a BrasilAPI)
//   444  ViaCEP não responde: só o timeout da API o interrompe (cai para a BrasilAPI)
//   555  ViaCEP diz que o CEP não existe (`erro: true`), sem consultar a BrasilAPI
//   666  ViaCEP fora do ar e BrasilAPI diz 404 (CEP não existe)
//   777  ViaCEP fora do ar e BrasilAPI responde com uma cidade que não está na lista do app
//   999  os dois fora do ar (CEP_LOOKUP_UNAVAILABLE)
const realFetch = globalThis.fetch;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input.url ?? String(input));
  const viaCep = /^https:\/\/viacep\.com\.br\/ws\/(\d{8})\/json\/$/.exec(url);
  const brasilApi = /^https:\/\/brasilapi\.com\.br\/api\/cep\/v1\/(\d{8})$/.exec(url);
  if (!viaCep && !brasilApi) return realFetch(input, init);

  const cep = (viaCep ?? brasilApi)[1];
  const mode = cep.slice(5);

  if (viaCep) {
    switch (mode) {
      case '111':
        return json(200, {
          cep,
          logradouro: 'Rua ViaCEP',
          bairro: 'Bairro ViaCEP',
          localidade: 'Belo Horizonte',
          uf: 'MG',
        });
      case '333':
        return json(200, { inesperado: true });
      case '444':
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal.reason));
        });
      case '555':
        return json(200, { erro: 'true' });
      default:
        return json(503, { message: 'indisponível' });
    }
  }

  switch (mode) {
    case '666':
      return json(404, { message: 'CEP não encontrado' });
    case '999':
      return json(503, { message: 'indisponível' });
    case '777':
      // Cidade fora da lista do app: o formulário avisa e deixa escolher.
      return json(200, {
        cep,
        street: 'Rua BrasilAPI',
        neighborhood: 'Bairro BrasilAPI',
        city: 'Sabará',
        state: 'MG',
      });
    default:
      return json(200, {
        cep,
        street: 'Rua BrasilAPI',
        neighborhood: 'Bairro BrasilAPI',
        city: 'Belo Horizonte',
        state: 'MG',
      });
  }
};
