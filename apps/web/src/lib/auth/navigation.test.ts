import { describe, expect, it } from 'vitest';
import {
  aboutYouPath,
  decideAccess,
  destinationFor,
  loginPathWithNext,
  safeNextPath,
  verifiedEmailPath,
} from './navigation';

const player = { access: { super: false, management: false } };
const manager = { access: { super: false, management: true } };
const superOnly = { access: { super: true, management: false } };
const superAndManager = { access: { super: true, management: true } };

describe('destinationFor', () => {
  it('escolhe a área pelo perfil', () => {
    expect(destinationFor(superOnly)).toBe('/super');
    expect(destinationFor(superAndManager)).toBe('/super');
    expect(destinationFor(manager)).toBe('/painel');
    expect(destinationFor(player)).toBe('/sem-acesso');
  });
});

describe('safeNextPath', () => {
  it('aceita só caminhos internos', () => {
    expect(safeNextPath('/painel/agenda?dia=1')).toBe('/painel/agenda?dia=1');
    expect(safeNextPath('//evil.com')).toBeUndefined();
    expect(safeNextPath('/\\evil.com')).toBeUndefined();
    expect(safeNextPath('https://evil.com')).toBeUndefined();
    expect(safeNextPath('painel')).toBeUndefined();
    expect(safeNextPath('/a\nb')).toBeUndefined();
    expect(safeNextPath(undefined)).toBeUndefined();
  });
});

describe('loginPathWithNext', () => {
  it('guarda o destino codificado', () => {
    expect(loginPathWithNext('/painel/agenda?dia=1')).toBe(
      '/entrar?next=%2Fpainel%2Fagenda%3Fdia%3D1',
    );
    expect(loginPathWithNext('//evil.com')).toBe('/entrar');
    expect(loginPathWithNext('/')).toBe('/entrar');
  });
});

describe('decideAccess', () => {
  const allow = { type: 'allow' };
  const to = (path: string) => ({ type: 'redirect', to: path });

  it('sem sessão: área protegida vai para /entrar com next', () => {
    expect(decideAccess({ pathname: '/painel', me: null })).toEqual(to('/entrar?next=%2Fpainel'));
    expect(decideAccess({ pathname: '/super/auditoria', search: '?p=2', me: null })).toEqual(
      to('/entrar?next=%2Fsuper%2Fauditoria%3Fp%3D2'),
    );
  });
  it('sem sessão: telas de login passam', () => {
    expect(decideAccess({ pathname: '/entrar', me: null })).toEqual(allow);
    expect(decideAccess({ pathname: '/cadastro', me: null })).toEqual(allow);
  });
  it('/super só com access.super', () => {
    expect(decideAccess({ pathname: '/super', me: superOnly })).toEqual(allow);
    expect(decideAccess({ pathname: '/super/espacos', me: manager })).toEqual(to('/painel'));
    expect(decideAccess({ pathname: '/super', me: player })).toEqual(to('/sem-acesso'));
  });
  it('/painel só com access.management', () => {
    expect(decideAccess({ pathname: '/painel/aulas', me: manager })).toEqual(allow);
    expect(decideAccess({ pathname: '/painel', me: superOnly })).toEqual(to('/super'));
    expect(decideAccess({ pathname: '/painel', me: player })).toEqual(to('/sem-acesso'));
  });
  it('Super em modo suporte entra no /painel; sem o modo continua indo para /super', () => {
    expect(decideAccess({ pathname: '/painel', me: superOnly, supportMode: true })).toEqual(allow);
    expect(decideAccess({ pathname: '/painel', me: superOnly, supportMode: false })).toEqual(
      to('/super'),
    );
    // O modo suporte não abre o painel para quem não é Super.
    expect(decideAccess({ pathname: '/painel', me: player, supportMode: true })).toEqual(
      to('/sem-acesso'),
    );
  });
  it('quem já tem sessão sai das telas de login para o next ou a área do perfil', () => {
    expect(decideAccess({ pathname: '/entrar', me: manager })).toEqual(to('/painel'));
    expect(decideAccess({ pathname: '/entrar', me: superOnly })).toEqual(to('/super'));
    expect(
      decideAccess({ pathname: '/entrar', search: '?next=%2Fpainel%2Fagenda', me: manager }),
    ).toEqual(to('/painel/agenda'));
    expect(decideAccess({ pathname: '/cadastro', search: '?next=//evil.com', me: player })).toEqual(
      to('/sem-acesso'),
    );
  });
  it('cadastro incompleto (decisão 66): /painel e /super levam ao completar cadastro', () => {
    const incomplete = { ...manager, profile: { missing: ['phone'] } };
    expect(decideAccess({ pathname: '/painel/agenda', search: '?d=1', me: incomplete })).toEqual(
      to('/completar-cadastro?next=%2Fpainel%2Fagenda%3Fd%3D1'),
    );
    const superIncomplete = { ...superOnly, profile: { missing: ['name', 'phone'] } };
    expect(decideAccess({ pathname: '/super', me: superIncomplete })).toEqual(
      to('/completar-cadastro?next=%2Fsuper'),
    );
    // Sem acesso à área, vale o destino do perfil (não há painel a liberar).
    expect(
      decideAccess({ pathname: '/painel', me: { ...player, profile: { missing: ['phone'] } } }),
    ).toEqual(to('/sem-acesso'));
    // Login com next e cadastro incompleto: o next passa pelo /painel, que pede o completar.
    expect(
      decideAccess({ pathname: '/painel', me: { ...manager, profile: { missing: [] } } }),
    ).toEqual(allow);
  });
  it('/completar-cadastro: sem sessão vai ao login; completo volta ao next ou à área', () => {
    expect(decideAccess({ pathname: '/completar-cadastro', me: null })).toEqual(
      to('/entrar?next=%2Fcompletar-cadastro'),
    );
    expect(
      decideAccess({
        pathname: '/completar-cadastro',
        me: { ...manager, profile: { missing: ['phone'] } },
      }),
    ).toEqual(allow);
    expect(
      decideAccess({
        pathname: '/completar-cadastro',
        search: '?next=%2Fpainel%2Fagenda',
        me: { ...manager, profile: { missing: [] } },
      }),
    ).toEqual(to('/painel/agenda'));
    expect(
      decideAccess({
        pathname: '/completar-cadastro',
        search: '?next=//evil.com',
        me: { ...superOnly, profile: { missing: [] } },
      }),
    ).toEqual(to('/super'));
  });
  it('/cadastro/sobre-voce: exige sessão, mas não é só para deslogados como o /cadastro', () => {
    expect(
      decideAccess({ pathname: '/cadastro/sobre-voce', search: '?next=%2Fpainel', me: null }),
    ).toEqual(to('/entrar?next=%2Fcadastro%2Fsobre-voce%3Fnext%3D%252Fpainel'));
    expect(
      decideAccess({ pathname: '/cadastro/sobre-voce', search: '?next=%2Fpainel', me: player }),
    ).toEqual(allow);
  });
  it('rotas fora das áreas passam', () => {
    expect(decideAccess({ pathname: '/painelx', me: null })).toEqual(allow);
    expect(decideAccess({ pathname: '/verificar-email', me: manager })).toEqual(allow);
  });
});

describe('aboutYouPath', () => {
  it('guarda o destino seguinte, inclusive a confirmação do e-mail com o convite', () => {
    expect(aboutYouPath(undefined)).toBe('/cadastro/sobre-voce');
    expect(aboutYouPath('//evil.com')).toBe('/cadastro/sobre-voce');
    const next = '/verificar-email?email=a%40b.com&next=%2Fconvite%2Fabc';
    const path = aboutYouPath(next);
    expect(new URLSearchParams(path.split('?')[1]).get('next')).toBe(next);
  });
});

describe('verifiedEmailPath', () => {
  it('sem destino, volta só para a confirmação', () => {
    expect(verifiedEmailPath(undefined)).toBe('/verificar-email?status=confirmado');
  });

  it('o link do e-mail mantém o convite que levou ao cadastro', () => {
    const query = verifiedEmailPath('/r/abc?aceitar=1').split('?')[1];
    expect(new URLSearchParams(query).get('next')).toBe('/r/abc?aceitar=1');
  });
});
