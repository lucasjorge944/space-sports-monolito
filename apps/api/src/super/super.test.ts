import { describe, expect, it } from 'vitest';
import { csvLine, csvLocalDateTime, csvMonth, csvUtcDateTime } from '../common/csv.js';
import { periodOf } from './finance.service.js';
import { slugify } from './super-spaces.service.js';

describe('slugify', () => {
  it('tira acentos e pontuação', () => {
    expect(slugify('Arena São João & Cia.')).toBe('arena-sao-joao-cia');
    expect(slugify('  Praia   Clube  ')).toBe('praia-clube');
  });

  it('limita o tamanho sem terminar em hífen', () => {
    const slug = slugify(`${'a'.repeat(69)} bbb`);
    expect(slug.length).toBeLessThanOrEqual(70);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('nome sem letras ou números vira um slug válido', () => {
    expect(slugify('!!!')).toBe('espaco');
    expect(slugify('A')).toBe('espaco');
  });
});

describe('datas dos CSVs', () => {
  it('saem em dd/mm/aaaa', () => {
    expect(csvUtcDateTime('2026-03-31T23:59:59.000Z')).toBe('31/03/2026 23:59:59');
    expect(csvLocalDateTime(new Date('2026-04-01T02:30:00Z'), 'America/Sao_Paulo')).toBe(
      '31/03/2026 23:30',
    );
    expect(csvMonth('2026-03-01')).toBe('03/2026');
  });
});

describe('csvLine', () => {
  it('separa por vírgula, termina em CRLF e deixa números crus', () => {
    expect(csvLine(['a', 10, 'b'])).toBe('a,10,b\r\n');
  });

  it('escapa vírgulas, aspas e quebras de linha', () => {
    expect(csvLine(['Arena "Sol", Mar', 'x\ny'])).toBe('"Arena ""Sol"", Mar","x\ny"\r\n');
  });

  it.each(['=1+1', '+55', '-10', '@cmd'])('neutraliza fórmula %j', (value) => {
    expect(csvLine([value])).toBe(`'${value}\r\n`);
  });

  it('não mexe no telefone completo', () => {
    expect(csvLine(['+5531999998888'])).toBe('+5531999998888\r\n');
  });
});

describe('periodOf', () => {
  it('usa os limites informados', () => {
    expect(periodOf({ from: '2026-03-01', to: '2026-03-31' })).toEqual({
      from: '2026-03-01',
      to: '2026-03-31',
    });
  });

  it('padrão: dia 1 do mês atual até hoje', () => {
    const { from, to } = periodOf({});
    expect(from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(to.slice(0, 7)).toBe(from.slice(0, 7));
    expect(to >= from).toBe(true);
  });
});
