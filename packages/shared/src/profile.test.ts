import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizePhone } from './masks';
import {
  birthDateSchema,
  brazilianPhoneSchema,
  missingProfileFields,
  signUpSchema,
  updateProfileSchema,
} from './profile';

const SPORT_A = '0192f3a4-5b6c-7d8e-9f01-23456789abcd';
const SPORT_B = '0192f3a4-5b6c-7d8e-9f01-23456789abce';

describe('brazilianPhoneSchema (decisão 64)', () => {
  it.each([
    '+5531999998888', // celular
    '+5511987654321',
    '+553133334444', // fixo
  ])('aceita %s', (phone) => {
    expect(brazilianPhoneSchema.safeParse(phone).success).toBe(true);
  });

  it.each([
    ['sem +55', '31999998888'],
    ['outro país', '+14155550123'],
    ['DDD com zero', '+5501999998888'],
    ['longo', '+55319999988889'],
    ['9 dígitos sem começar com 9', '+5531899998888'],
    ['fixo começando com 1', '+553113334444'],
    ['curto', '+55319999888'],
    ['com máscara', '+55 (31) 99999-8888'],
  ])('recusa %s', (_label, phone) => {
    expect(brazilianPhoneSchema.safeParse(phone).success).toBe(false);
  });

  it('aceita o que normalizePhone produz a partir da máscara', () => {
    const phone = normalizePhone('(31) 99999-8888');
    expect(phone).toBe('+5531999998888');
    expect(brazilianPhoneSchema.safeParse(phone).success).toBe(true);
  });
});

describe('birthDateSchema (decisão 68)', () => {
  afterEach(() => vi.useRealTimers());

  it('aceita de 1900 até hoje', () => {
    expect(birthDateSchema.safeParse('1900-01-01').success).toBe(true);
    expect(birthDateSchema.safeParse('1990-05-17').success).toBe(true);
  });

  it('recusa antes de 1900, data inexistente e formato errado', () => {
    expect(birthDateSchema.safeParse('1899-12-31').success).toBe(false);
    expect(birthDateSchema.safeParse('2001-02-29').success).toBe(false);
    expect(birthDateSchema.safeParse('17/05/1990').success).toBe(false);
  });

  it('"hoje" é o dia de São Paulo, não o de UTC', () => {
    // 2026-11-03 23:30 em São Paulo = 2026-11-04 02:30 UTC.
    vi.useFakeTimers({ now: new Date('2026-11-04T02:30:00Z') });
    expect(birthDateSchema.safeParse('2026-11-03').success).toBe(true);
    expect(birthDateSchema.safeParse('2026-11-04').success).toBe(false);
  });
});

describe('updateProfileSchema', () => {
  it('é parcial e recusa campos fora do perfil', () => {
    expect(updateProfileSchema.parse({})).toEqual({});
    expect(updateProfileSchema.safeParse({ email: 'outro@exemplo.com' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ avatarUrl: 'https://x/y.png' }).success).toBe(false);
  });

  it('nível do esporte é opcional e vira nulo', () => {
    expect(
      updateProfileSchema.parse({
        favoriteSports: [{ sportId: SPORT_A }, { sportId: SPORT_B, level: 'PRO' }],
      }),
    ).toEqual({
      favoriteSports: [
        { sportId: SPORT_A, level: null },
        { sportId: SPORT_B, level: 'PRO' },
      ],
    });
  });

  it('recusa esporte repetido, nome vazio e telefone apagado', () => {
    expect(
      updateProfileSchema.safeParse({
        favoriteSports: [{ sportId: SPORT_A }, { sportId: SPORT_A, level: 'PRO' }],
      }).success,
    ).toBe(false);
    expect(updateProfileSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ phone: null }).success).toBe(false);
  });

  it('nascimento e gênero podem ser apagados', () => {
    expect(updateProfileSchema.parse({ birthDate: null, gender: null })).toEqual({
      birthDate: null,
      gender: null,
    });
  });
});

describe('signUpSchema', () => {
  it('exige o telefone brasileiro', () => {
    const base = { name: 'Maria', email: 'maria@exemplo.com', password: 'senha-forte-123' };
    expect(signUpSchema.safeParse(base).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, phone: '+5531999998888' }).success).toBe(true);
  });
});

describe('missingProfileFields (decisão 66)', () => {
  it('pede só nome e telefone', () => {
    expect(missingProfileFields({ name: 'Maria', phone: '+5531999998888' })).toEqual([]);
    expect(missingProfileFields({ name: 'Maria', phone: null })).toEqual(['phone']);
    expect(missingProfileFields({ name: '  ', phone: null })).toEqual(['name', 'phone']);
  });
});
