import { describe, expect, it } from 'vitest';
import {
  aboutIsEmpty,
  aboutPayload,
  phoneToE164,
  profileChanges,
  profileFormOf,
  setSportLevel,
  toggleSport,
  validateBirthDate,
  validatePhone,
} from './profile';

const FUT = '00000000-0000-4000-8000-000000000301';
const BEACH = '00000000-0000-4000-8000-000000000302';

const me = {
  name: 'Ana Souza',
  phone: '+5531999998888',
  birthDate: '1990-05-20',
  gender: 'FEMALE' as const,
  favoriteSports: [
    { sport: { id: FUT, name: 'Futevôlei', slug: 'futevolei' }, level: 'BEGINNER' as const },
  ],
};

describe('telefone (decisão 64)', () => {
  it('aceita celular e fixo brasileiros com DDD, com ou sem máscara', () => {
    expect(phoneToE164('(31) 99999-8888')).toBe('+5531999998888');
    expect(phoneToE164('(31) 3333-4444')).toBe('+553133334444');
    expect(phoneToE164('+5531999998888')).toBe('+5531999998888');
    expect(validatePhone('(31) 99999-8888')).toBeUndefined();
  });

  it('recusa vazio, incompleto e número de outro país', () => {
    expect(validatePhone('')).toBe('Informe seu telefone com DDD');
    expect(validatePhone('(31) 9999-88')).toBe('Informe um telefone brasileiro com DDD');
    expect(validatePhone('(01) 99999-8888')).toBe('Informe um telefone brasileiro com DDD');
    expect(validatePhone('+1 415 555 2671')).toBe('Informe um telefone brasileiro com DDD');
    expect(phoneToE164('+14155552671')).toBeNull();
  });
});

describe('data de nascimento (decisão 68)', () => {
  it('é opcional, entre 1900 e hoje', () => {
    expect(validateBirthDate('', '2026-11-03')).toBeUndefined();
    expect(validateBirthDate('1900-01-01', '2026-11-03')).toBeUndefined();
    expect(validateBirthDate('2026-11-03', '2026-11-03')).toBeUndefined();
    expect(validateBirthDate('1899-12-31', '2026-11-03')).toBe('Informe uma data a partir de 1900');
    expect(validateBirthDate('2026-11-04', '2026-11-03')).toBe(
      'A data de nascimento não pode ser no futuro',
    );
  });
});

describe('esportes favoritos (decisão 69)', () => {
  it('marca sem nível, escolhe o nível e desmarca descartando o nível', () => {
    let list = toggleSport([], FUT);
    expect(list).toEqual([{ sportId: FUT, level: null }]);
    list = setSportLevel(list, FUT, 'PRO');
    expect(list).toEqual([{ sportId: FUT, level: 'PRO' }]);
    list = toggleSport(list, BEACH);
    list = toggleSport(list, FUT);
    expect(list).toEqual([{ sportId: BEACH, level: null }]);
  });
});

describe('Sobre você (decisão 70)', () => {
  it('manda os vazios como nulo e a lista completa de esportes', () => {
    expect(aboutPayload({ birthDate: '', gender: '', sports: [] })).toEqual({
      birthDate: null,
      gender: null,
      favoriteSports: [],
    });
    expect(
      aboutPayload({
        birthDate: '1990-05-20',
        gender: 'UNDISCLOSED',
        sports: [{ sportId: FUT, level: null }],
      }),
    ).toEqual({
      birthDate: '1990-05-20',
      gender: 'UNDISCLOSED',
      favoriteSports: [{ sportId: FUT, level: null }],
    });
  });

  it('conta sem nenhum dado de "Sobre você" é considerada nova', () => {
    expect(aboutIsEmpty({ birthDate: null, gender: null, favoriteSports: [] })).toBe(true);
    expect(aboutIsEmpty(me)).toBe(false);
  });
});

describe('Meu perfil: só o que mudou vai no PATCH', () => {
  it('sem alteração, corpo vazio', () => {
    expect(profileChanges(me, profileFormOf(me))).toEqual({});
  });

  it('nome, telefone, nascimento, gênero e esportes alterados', () => {
    const form = {
      ...profileFormOf(me),
      name: '  Ana S. ',
      phone: '(31) 98888-7777',
      birthDate: '',
      gender: '' as const,
      sports: [
        { sportId: FUT, level: 'ADVANCED' as const },
        { sportId: BEACH, level: null },
      ],
    };
    expect(profileChanges(me, form)).toEqual({
      name: 'Ana S.',
      phone: '+5531988887777',
      birthDate: null,
      gender: null,
      favoriteSports: [
        { sportId: FUT, level: 'ADVANCED' },
        { sportId: BEACH, level: null },
      ],
    });
  });

  it('a mesma lista de esportes em outra ordem não conta como mudança', () => {
    const two = {
      ...me,
      favoriteSports: [
        ...me.favoriteSports,
        { sport: { id: BEACH, name: 'Beach tênis', slug: 'beach-tenis' }, level: null },
      ],
    };
    const form = { ...profileFormOf(two), sports: [...profileFormOf(two).sports].reverse() };
    expect(profileChanges(two, form)).toEqual({});
  });

  it('o telefone mascarado do formulário é o mesmo do perfil', () => {
    expect(profileFormOf(me).phone).toBe('(31) 99999-8888');
  });
});
