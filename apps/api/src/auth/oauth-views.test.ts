import type { MyClassSessionDetail, PlayerBookingDetail } from '@space-sports/shared';
import { describe, expect, it } from 'vitest';
import { bookingDetailForOAuth, classSessionDetailForOAuth } from './oauth-views.js';

const ME = '00000000-0000-7000-8000-000000000001';
const OTHER = '00000000-0000-7000-8000-000000000002';

describe('visão do token do MCP (RN-MCP-05)', () => {
  it('reserva: terceiros pelo primeiro nome, sem links de convite nem sugestão de conta', () => {
    const detail = {
      organizer: { userId: OTHER, name: 'Carla Souza Lima', phone: null },
      participants: [
        {
          id: 'p1',
          name: 'Carla Souza Lima',
          isOrganizer: true,
          isMe: false,
          shareCents: 5000,
          status: 'ACCEPTED',
          inviteToken: null,
          inviteUrl: null,
          suggestedUser: null,
          hasAccount: true,
        },
        {
          id: 'p2',
          name: 'Ana Maria',
          isOrganizer: false,
          isMe: true,
          shareCents: 5000,
          status: 'INVITED',
          inviteToken: 'token-secreto',
          inviteUrl: 'https://exemplo.com/convite/token-secreto',
          suggestedUser: { id: OTHER, firstName: 'Carla' },
          hasAccount: false,
        },
      ],
    } as unknown as PlayerBookingDetail;
    const view = bookingDetailForOAuth(detail, ME);
    expect(view.organizer).toEqual({ userId: OTHER, name: 'Carla', phone: null });
    expect(view.participants.map((p) => p.name)).toEqual(['Carla', 'Ana Maria']);
    expect(view.participants[1]).toMatchObject({
      inviteToken: null,
      inviteUrl: null,
      suggestedUser: null,
    });
    // O próprio usuário organizador continua com o nome completo.
    const mine = bookingDetailForOAuth(
      { ...detail, organizer: { userId: ME, name: 'Ana Maria', phone: null } },
      ME,
    );
    expect(mine.organizer.name).toBe('Ana Maria');
  });

  it('aula: colegas pelo primeiro nome e sem foto; o próprio usuário, como está', () => {
    const detail = {
      confirmed: [
        { userId: OTHER, name: 'Bruno Costa', avatarUrl: 'https://exemplo.com/b.png' },
        { userId: ME, name: 'Ana Maria', avatarUrl: 'https://exemplo.com/a.png' },
      ],
    } as unknown as MyClassSessionDetail;
    expect(classSessionDetailForOAuth(detail, ME).confirmed).toEqual([
      { userId: OTHER, name: 'Bruno', avatarUrl: null },
      { userId: ME, name: 'Ana Maria', avatarUrl: 'https://exemplo.com/a.png' },
    ]);
  });
});
