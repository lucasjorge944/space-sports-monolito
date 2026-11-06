import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let session: { id: string } | null = null;
let endFails = false;

vi.mock('@space-sports/api-client', () => ({
  superEndSupportSession: vi.fn(async (id: string) => {
    calls.push(`end:${id}`);
    if (endFails) throw new Error('falhou');
  }),
}));
vi.mock('@/lib/support/session', () => ({
  getSupportSession: () => session,
  clearSupportSession: () => calls.push('clear'),
}));
vi.mock('./client', () => ({
  authClient: { signOut: vi.fn(async () => void calls.push('signOut')) },
}));

const assign = vi.fn();
vi.stubGlobal('window', { location: { assign } });

import { signOut } from './sign-out';

describe('signOut', () => {
  beforeEach(() => {
    calls.length = 0;
    assign.mockClear();
    session = null;
    endFails = false;
  });

  it('encerra a sessão de suporte e limpa o estado local antes do logout', async () => {
    session = { id: 'sess-1' };
    await signOut();
    expect(calls).toEqual(['end:sess-1', 'clear', 'signOut']);
    expect(assign).toHaveBeenCalledWith('/entrar');
  });

  it('segue para o logout mesmo se encerrar a sessão de suporte falhar', async () => {
    session = { id: 'sess-1' };
    endFails = true;
    await signOut();
    expect(calls).toEqual(['end:sess-1', 'clear', 'signOut']);
  });

  it('sem sessão de suporte só faz o logout', async () => {
    await signOut();
    expect(calls).toEqual(['signOut']);
  });
});
