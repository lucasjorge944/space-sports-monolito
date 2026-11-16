/**
 * Filtro de contato em textos livres de terceiros (decisão 122: nome sim, contato nunca). É uma
 * defesa PARCIAL, depois da barreira que vale: a API, que só manda os campos permitidos para o
 * token do MCP e anula o comentário oculto ou denunciado como dado pessoal. Aqui só se pega o
 * contato escrito à mão num texto sem denúncia (ex.: o comentário de uma avaliação ou a descrição
 * de um espaço). Não reconhece telefone por extenso, com letras no meio ou com separadores fora dos
 * usuais, nem outros dados pessoais. Usado pela gestão (MCP2.3) e pelo Super (MCP2.4).
 */

export const CONTACT_REDACTED = '[contato removido]';

/**
 * Tamanho máximo de um texto livre na saída das tools. A regex de e-mail é quadrática no tamanho
 * do texto (medido: ~3 ms em 2 mil caracteres, ~300 ms em 20 mil, ~2 s em 50 mil), então o texto é
 * cortado ANTES do filtro. Os textos de hoje cabem: comentário de avaliação até 500 caracteres e
 * descrição do espaço até 2 mil (schemas de `packages/shared`).
 */
export const FREE_TEXT_MAX_LENGTH = 2000;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Telefone: 8 dígitos ou mais (os telefones têm de 8 a 13; mais longos, como cartão ou documento,
 * também saem, inteiros), com `+` e `(` opcionais na frente e, entre um dígito e outro, até 3
 * separadores usuais (espaço, hífen, ponto, parênteses). Casa `(31) 9 9999-8888`,
 * `31 9 9999 8888`, `99999-8888`, `+55 (31) 99999-8888` e `31.99999.8888`. A barra, a vírgula e
 * os dois-pontos não são separadores: datas (`10/11/2026`), valores (`R$ 150,00`) e horas
 * (`18:00`) passam.
 */
const PHONE = /(?<!\d)(?:\+\s?)?\(?\d(?:[\s().\-‐–—]{0,3}\d){7,}/g;

/**
 * Fim de um texto cortado que pode ser o começo de um contato: números com separadores ou um
 * pedaço de e-mail (com o `@`). Sai junto, para o corte não deixar meio telefone que o filtro já não
 * reconhece (ex.: `31 9 9999` de `31 9 9999-8888`).
 */
const CONTACT_TAIL = /(?:[+(]?\d[\d\s().\-‐–—]*|[A-Za-z0-9._%+-]*@[A-Za-z0-9.-]*)$/;

/**
 * Troca e-mails e números com cara de telefone por `[contato removido]`. Texto acima de `maxLength`
 * é cortado antes (com `…` no fim), sem deixar um contato pela metade no ponto do corte.
 */
export function redactContacts(text: string, maxLength = FREE_TEXT_MAX_LENGTH): string {
  const limited =
    text.length > maxLength
      ? `${text.slice(0, maxLength).replace(CONTACT_TAIL, '').trimEnd()}…`
      : text;
  return limited.replace(EMAIL, CONTACT_REDACTED).replace(PHONE, CONTACT_REDACTED);
}
