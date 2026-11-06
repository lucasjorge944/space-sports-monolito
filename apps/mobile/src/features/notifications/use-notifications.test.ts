import type { NotificationPage } from '@space-sports/api-client';
import { markReadInPages } from './use-notifications';

const item = (id: string, readAt: string | null = null) => ({
  id,
  type: 'BOOKING_CONFIRMED',
  title: 't',
  body: 'b',
  data: null,
  readAt,
  createdAt: '2026-10-28T12:00:00.000Z',
});

const page = (items: ReturnType<typeof item>[], unreadCount: number): NotificationPage => ({
  items,
  nextCursor: null,
  unreadCount,
});

const NOW = '2026-10-28T13:00:00.000Z';

describe('markReadInPages', () => {
  it('marca só a notificação pedida e baixa o contador', () => {
    const data = { pages: [page([item('a'), item('b')], 2)], pageParams: [undefined] };
    const next = markReadInPages(data, new Set(['a']), NOW);
    expect(next?.pages[0]?.items.map((i) => i.readAt)).toEqual([NOW, null]);
    expect(next?.pages[0]?.unreadCount).toBe(1);
  });

  it('não conta de novo uma notificação que já estava lida', () => {
    const data = { pages: [page([item('a', NOW)], 0)], pageParams: [undefined] };
    expect(markReadInPages(data, new Set(['a']), NOW)?.pages[0]?.unreadCount).toBe(0);
  });

  it('"all" marca todas as páginas e zera o contador', () => {
    const data = {
      pages: [page([item('a')], 2), page([item('b')], 2)],
      pageParams: [undefined, 'c'],
    };
    const next = markReadInPages(data, 'all', NOW);
    expect(next?.pages.every((p) => p.items.every((i) => i.readAt === NOW))).toBe(true);
    expect(next?.pages.map((p) => p.unreadCount)).toEqual([0, 0]);
  });

  it('ignora o cache do contador (sem páginas)', () => {
    const single = page([item('a')], 1);
    expect(markReadInPages(single as never, new Set(['a']), NOW)).toBe(single);
  });
});
