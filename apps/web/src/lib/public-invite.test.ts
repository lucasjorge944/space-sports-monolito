import { ApiError, type PublicInvitePreview } from '@space-sports/api-client';
import { describe, expect, it } from 'vitest';
import {
  acceptAfterAuthPath,
  formatInviteWhen,
  inviteAppLink,
  isSlotTakenError,
  publicInviteView,
  signUpWithInvitePath,
} from './public-invite';

const NOW = new Date('2026-11-10T12:00:00.000Z');

function invite(over: Partial<PublicInvitePreview> = {}, bookingOver = {}): PublicInvitePreview {
  return {
    status: 'INVITED',
    canAnswer: true,
    accountRequired: false,
    slotTaken: false,
    shareCents: 6000,
    booking: {
      space: { name: 'Arena', slug: 'arena', timeZone: 'America/Sao_Paulo' },
      court: { name: 'Quadra 1' },
      sport: { name: 'Futevôlei', slug: 'futevolei' },
      startsAt: '2026-11-11T12:00:00.000Z',
      endsAt: '2026-11-11T13:00:00.000Z',
      status: 'CONFIRMED',
      organizerFirstName: 'Ana',
      ...bookingOver,
    },
    ...over,
  };
}

describe('publicInviteView', () => {
  it('convite pendente em reserva aberta pode ser respondido', () => {
    expect(publicInviteView(invite(), NOW)).toBe('open');
  });

  it('convite direto a uma conta não aceita resposta sem conta', () => {
    const direct = invite({ accountRequired: true, canAnswer: false });
    expect(publicInviteView(direct, NOW)).toBe('account-only');
  });

  it('separa quem já respondeu da vaga que ficou com uma conta', () => {
    expect(publicInviteView(invite({ status: 'ACCEPTED', canAnswer: false }), NOW)).toBe(
      'answered',
    );
    expect(
      publicInviteView(
        invite({ status: 'ACCEPTED', canAnswer: false, accountRequired: true }),
        NOW,
      ),
    ).toBe('taken');
    expect(publicInviteView(invite({ status: 'DECLINED', canAnswer: false }), NOW)).toBe(
      'declined',
    );
  });

  it('reserva cancelada vale mais que a resposta', () => {
    const accepted = invite({ status: 'ACCEPTED', canAnswer: false }, { status: 'CANCELLED' });
    expect(publicInviteView(accepted, NOW)).toBe('cancelled');
  });

  it('reserva terminada expira o convite, pelo status ou pelo horário', () => {
    expect(publicInviteView(invite({ canAnswer: false }, { status: 'COMPLETED' }), NOW)).toBe(
      'expired',
    );
    expect(publicInviteView(invite({ canAnswer: false }, { status: 'NO_SHOW' }), NOW)).toBe(
      'expired',
    );
    expect(
      publicInviteView(
        invite({ status: 'ACCEPTED', canAnswer: false }, { endsAt: '2026-11-10T11:59:00.000Z' }),
        NOW,
      ),
    ).toBe('expired');
  });

  it('segue o canAnswer da API se ela fechar o convite antes do relógio do navegador', () => {
    expect(publicInviteView(invite({ canAnswer: false }), NOW)).toBe('expired');
  });
});

describe('isSlotTakenError', () => {
  const apiError = (status: number, code: string) => new ApiError({ status, code, message: code });

  it('só a recusa por vaga de outra pessoa conta', () => {
    expect(isSlotTakenError(apiError(409, 'INVITE_SLOT_TAKEN'))).toBe(true);
    expect(isSlotTakenError(apiError(409, 'INVITE_UNAVAILABLE'))).toBe(false);
    expect(isSlotTakenError(apiError(429, 'TOO_MANY_REQUESTS'))).toBe(false);
    expect(isSlotTakenError(null)).toBe(false);
    expect(isSlotTakenError(new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('formatInviteWhen', () => {
  it('mostra dia e horário no fuso do espaço', () => {
    expect(
      formatInviteWhen('2026-11-14T21:00:00.000Z', '2026-11-14T22:00:00.000Z', 'America/Sao_Paulo'),
    ).toBe('Sáb, 14/11/2026, 18:00 às 19:00');
    expect(
      formatInviteWhen('2026-11-14T21:00:00.000Z', '2026-11-14T22:00:00.000Z', 'America/Manaus'),
    ).toBe('Sáb, 14/11/2026, 17:00 às 18:00');
  });
});

describe('links do convite', () => {
  it('o cadastro leva o token até voltar ao convite', () => {
    const next = new URLSearchParams(signUpWithInvitePath('abc').split('?')[1]).get('next');
    expect(next).toBe(acceptAfterAuthPath('abc'));
    expect(next).toBe('/r/abc?aceitar=1');
  });

  it('abre no esquema do app', () => {
    expect(inviteAppLink('abc')).toBe('spacesports://convite/abc');
  });
});
