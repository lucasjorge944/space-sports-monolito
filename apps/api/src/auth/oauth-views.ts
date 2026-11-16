import type {
  MyClassSessionDetail,
  PlayerBooking,
  PlayerBookingDetail,
  PlayerBookingPage,
} from '@space-sports/shared';
import { firstName } from '../users/normalize.js';

// Visão reduzida das respostas para o token do MCP (RN-MCP-05, docs/14-mcp.md 3.4): a barreira é a
// API, porque o cliente pode chamar as rotas da lista direto, sem passar pelo `apps/mcp`. Nenhuma
// das rotas da lista traz telefone, e-mail ou documento de terceiros; aqui saem também o nome
// completo e a foto de outras pessoas, os links de convite (credenciais) e as sugestões de conta.

const otherName = (name: string) => firstName(name);

function bookingForOAuth<T extends PlayerBooking>(booking: T, userId: string): T {
  const { organizer } = booking;
  return {
    ...booking,
    organizer: {
      ...organizer,
      name: organizer.userId === userId ? organizer.name : otherName(organizer.name),
      phone: null,
    },
  };
}

export function bookingPageForOAuth(page: PlayerBookingPage, userId: string): PlayerBookingPage {
  return { ...page, items: page.items.map((item) => bookingForOAuth(item, userId)) };
}

export function bookingDetailForOAuth<T extends PlayerBookingDetail>(detail: T, userId: string): T {
  return {
    ...bookingForOAuth(detail, userId),
    participants: detail.participants.map((participant) => ({
      ...participant,
      name: participant.isMe || !participant.name ? participant.name : otherName(participant.name),
      inviteToken: null,
      inviteUrl: null,
      suggestedUser: null,
    })),
  };
}

export function classSessionDetailForOAuth<T extends MyClassSessionDetail>(
  detail: T,
  userId: string,
): T {
  return {
    ...detail,
    confirmed: detail.confirmed.map((student) =>
      student.userId === userId
        ? student
        : { ...student, name: otherName(student.name), avatarUrl: null },
    ),
  };
}
