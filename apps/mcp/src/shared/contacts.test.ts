import { describe, expect, it } from 'vitest';
import { CONTACT_REDACTED, FREE_TEXT_MAX_LENGTH, redactContacts } from './contacts.js';

describe('redactContacts (defesa parcial, decisão 122)', () => {
  it.each([
    '(31) 9 9999-8888',
    '31 9 9999 8888',
    '99999-8888',
    '9999-8888',
    '31999998888',
    '+55 (31) 99999-8888',
    '+5531999998888',
    '55 31 9 9999 8888',
    '31.99999.8888',
    '(31)99999–8888',
    '123.456.789-09',
  ])('tira o número %s', (number) => {
    const text = `Me chama no ${number}, valeu.`;
    expect(redactContacts(text)).toBe(`Me chama no ${CONTACT_REDACTED}, valeu.`);
  });

  it('tira o e-mail', () => {
    expect(redactContacts('escreve para fulano.silva+bt@example.com.br')).toBe(
      `escreve para ${CONTACT_REDACTED}`,
    );
  });

  it.each([
    'Joguei em 10/11/2026 das 18:00 às 20:00.',
    'Paguei R$ 150,00 pela hora; nota 10.',
    'Placar 6-4 6-3 7-5 na quadra 2.',
    'Quadra 1 e 2, umas 1234567 bolinhas.',
  ])('não mexe em texto sem contato: %s', (text) => {
    expect(redactContacts(text)).toBe(text);
  });

  it('sequência mais longa que um telefone (ex.: cartão) sai inteira', () => {
    expect(redactContacts('cartão 4111 1111 1111 1111 ok')).toBe(`cartão ${CONTACT_REDACTED} ok`);
    expect(redactContacts('código 12345678901234567890')).toBe(`código ${CONTACT_REDACTED}`);
  });
});

describe('redactContacts com texto longo', () => {
  it('corta antes de filtrar: texto enorme sem @ não trava (a regex de e-mail é quadrática)', () => {
    const text = 'a'.repeat(200_000);
    const started = performance.now();
    const result = redactContacts(text);
    expect(performance.now() - started).toBeLessThan(500);
    expect(result).toHaveLength(FREE_TEXT_MAX_LENGTH + 1);
    expect(result.endsWith('…')).toBe(true);
  });

  it('texto até o limite fica inteiro', () => {
    const text = `${'b'.repeat(FREE_TEXT_MAX_LENGTH - 20)} 31 9 9999-8888`;
    expect(redactContacts(text)).toBe(
      `${'b'.repeat(FREE_TEXT_MAX_LENGTH - 20)} ${CONTACT_REDACTED}`,
    );
  });

  it.each([
    ['telefone', '31 9 9999-8888', 9],
    ['e-mail', 'fulano.silva@example.com', 16],
  ])('o corte não deixa meio %s para trás', (_label, contact, cut) => {
    const prefix = 'x '.repeat(50);
    // O limite cai no meio do contato (no e-mail, depois do @).
    const text = `${prefix}${contact} e mais texto depois`;
    const result = redactContacts(text, prefix.length + cut);
    expect(result).toBe(`${prefix.trimEnd()}…`);
    expect(result).not.toContain(contact.slice(0, cut));
  });

  it('o limite é configurável', () => {
    expect(redactContacts('abcdefghij', 5)).toBe('abcde…');
  });
});
