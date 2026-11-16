import { describe, expect, it } from 'vitest';
import { oauthOriginContext } from '../auth/oauth-origin-context.js';
import { supportContext } from '../auth/support-context.js';
import { type AuditEntry, audit, type DbOrTx } from './db-utils.js';

/** Banco falso que guarda o que o `audit()` insere. */
function fakeDb() {
  const rows: Record<string, unknown>[] = [];
  const db = {
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        rows.push(row);
      },
    }),
  } as unknown as DbOrTx;
  return { db, rows };
}

const entry: AuditEntry = {
  actorId: '00000000-0000-7000-8000-000000000001',
  spaceId: null,
  action: 'class_attendance.add',
  entity: 'class_session',
  entityId: null,
  diff: { status: 'CONFIRMED' },
};

describe('audit: marcas de origem', () => {
  it('fora de contexto, grava a linha como veio', async () => {
    const { db, rows } = fakeDb();
    await audit(db, entry);
    expect(rows).toEqual([{ ...entry, actingAsSuper: false }]);
  });

  it('com o token do MCP (RN-MCP-03), acrescenta a origem e o cliente ao diff', async () => {
    const { db, rows } = fakeDb();
    await oauthOriginContext.run({ clientId: 'https://claude.example.com/c.json' }, () =>
      audit(db, entry),
    );
    expect(rows[0]).toMatchObject({
      actingAsSuper: false,
      diff: {
        status: 'CONFIRMED',
        origin: 'MCP',
        oauthClientId: 'https://claude.example.com/c.json',
      },
    });
  });

  it('no modo suporte, segue com a sessão de suporte e o Super', async () => {
    const { db, rows } = fakeDb();
    await supportContext.run({ sessionId: 's-1' }, () => audit(db, { ...entry, diff: undefined }));
    expect(rows[0]).toMatchObject({ actingAsSuper: true, diff: { supportSessionId: 's-1' } });
  });
});
