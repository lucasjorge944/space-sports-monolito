import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExpoPushSender } from './push-sender.js';

const respond = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('ExpoPushSender', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('envia em lote e traduz os tickets', async () => {
    const fetchMock = vi.fn(() =>
      respond({
        data: [
          { status: 'ok', id: 'abc' },
          {
            status: 'error',
            message: 'não registrado',
            details: { error: 'DeviceNotRegistered' },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const sender = new ExpoPushSender({ EXPO_ACCESS_TOKEN: 'segredo' });

    const tickets = await sender.send([
      { to: 'ExponentPushToken[a]', title: 'T', body: 'B', data: { x: 1 } },
      { to: 'ExponentPushToken[b]', title: 'T', body: 'B' },
    ]);

    expect(tickets).toEqual([
      { status: 'ok', id: 'abc' },
      { status: 'error', error: 'DeviceNotRegistered', message: 'não registrado' },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer segredo');
    expect(JSON.parse(init.body as string)[0]).toMatchObject({
      to: 'ExponentPushToken[a]',
      data: { x: 1 },
      sound: 'default',
    });
  });

  it('divide em lotes de 100 mensagens', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) =>
      respond({
        data: (JSON.parse(init.body as string) as unknown[]).map(() => ({
          status: 'ok',
          id: 'x',
        })),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const messages = Array.from({ length: 250 }, (_, i) => ({
      to: `ExponentPushToken[${i}]`,
      title: 'T',
      body: 'B',
    }));

    const tickets = await new ExpoPushSender({}).send(messages);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(tickets).toHaveLength(250);
  });

  it.each([429, 500, 503])(
    'falha de transporte (%i) lança, para o job tentar de novo',
    async (status) => {
      vi.stubGlobal('fetch', () => respond({ errors: [] }, status));
      await expect(
        new ExpoPushSender({}).send([{ to: 'ExponentPushToken[a]', title: 'T', body: 'B' }]),
      ).rejects.toThrow(String(status));
    },
  );

  it('lê os recibos e ignora os ainda não prontos', async () => {
    vi.stubGlobal('fetch', () =>
      respond({
        data: {
          t1: { status: 'ok' },
          t2: { status: 'error', details: { error: 'DeviceNotRegistered' } },
        },
      }),
    );
    expect(await new ExpoPushSender({}).receipts(['t1', 't2', 't3'])).toEqual({
      t1: { status: 'ok' },
      t2: { status: 'error', error: 'DeviceNotRegistered' },
    });
  });
});
