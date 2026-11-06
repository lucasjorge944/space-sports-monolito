import { isApiError, type PublicInvitePreview } from '@space-sports/api-client';
import { utcToZoned } from '@space-sports/shared';
import { formatDayLabel } from '@/lib/format';

/** Situação do convite na página pública (RF-CONTACT-02). */
export type PublicInviteView =
  /** Pode responder sem conta. */
  | 'open'
  /** Convite direto a uma conta: só ela responde. */
  | 'account-only'
  /** Uma conta já ficou com a vaga. */
  | 'taken'
  /** Já tem presença confirmada, sem conta. */
  | 'answered'
  | 'declined'
  | 'cancelled'
  /** A reserva terminou. */
  | 'expired';

/**
 * Lê a prévia da API. A reserva vem antes da resposta: depois de cancelada ou terminada, o que a
 * pessoa respondeu não importa mais. `canAnswer` é a regra de verdade para quem ainda não respondeu.
 */
export function publicInviteView(
  invite: Pick<PublicInvitePreview, 'status' | 'canAnswer' | 'accountRequired' | 'booking'>,
  now: Date = new Date(),
): PublicInviteView {
  const { booking } = invite;
  if (booking.status === 'CANCELLED') return 'cancelled';
  if (booking.status !== 'CONFIRMED' || new Date(booking.endsAt) <= now) return 'expired';
  if (invite.status === 'DECLINED') return 'declined';
  if (invite.status === 'ACCEPTED') return invite.accountRequired ? 'taken' : 'answered';
  if (invite.accountRequired) return 'account-only';
  return invite.canAnswer ? 'open' : 'expired';
}

/**
 * A API recusou a confirmação porque a vaga é de outra pessoa. A prévia é anônima e, depois de
 * confirmada, vale tanto para quem ficou com a vaga quanto para quem chegou tarde: só este erro
 * garante que quem está na tela não ficou com ela.
 */
export function isSlotTakenError(error: unknown): boolean {
  return isApiError(error) && error.code === 'INVITE_SLOT_TAKEN';
}

const clock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** No fuso do espaço, que é a hora em que a pessoa precisa chegar: `Sáb, 14/11/2026, 18:00 às 19:00`. */
export function formatInviteWhen(startsAt: string, endsAt: string, timeZone: string): string {
  const start = utcToZoned(new Date(startsAt), timeZone);
  const end = utcToZoned(new Date(endsAt), timeZone);
  return `${formatDayLabel(start.date)}, ${clock(start.minuteOfDay)} às ${clock(end.minuteOfDay)}`;
}

/** Volta para o convite e aceita assim que houver sessão (RF-CONTACT-03). */
export function acceptAfterAuthPath(token: string): string {
  return `/r/${encodeURIComponent(token)}?aceitar=1`;
}

/** Cadastro levando o token: o `next` sobrevive à verificação do e-mail. */
export function signUpWithInvitePath(token: string): string {
  return `/cadastro?next=${encodeURIComponent(acceptAfterAuthPath(token))}`;
}

export function signInWithInvitePath(token: string): string {
  return `/entrar?next=${encodeURIComponent(acceptAfterAuthPath(token))}`;
}

/** O esquema que o app já aceita (a URL https abre no navegador de quem não tem o app). */
export function inviteAppLink(token: string): string {
  return `spacesports://convite/${encodeURIComponent(token)}`;
}
