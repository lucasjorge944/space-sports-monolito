import type { DeletionRequestPendingItem } from '@space-sports/api-client';
import { formatMoney } from '@/lib/format';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Pendências de um espaço para a equipe avaliar o pedido (não impedem a exclusão, decisão 40). */
export function pendingParts(item: DeletionRequestPendingItem): string[] {
  const parts: string[] = [];
  if (item.upcomingBookings > 0)
    parts.push(plural(item.upcomingBookings, 'reserva futura', 'reservas futuras'));
  if (item.openRecurringBookings > 0)
    parts.push(plural(item.openRecurringBookings, 'mensalista', 'mensalistas'));
  if (item.upcomingRecurringOccurrences > 0)
    parts.push(
      plural(item.upcomingRecurringOccurrences, 'ocorrência futura', 'ocorrências futuras'),
    );
  if (item.openSubscriptions > 0)
    parts.push(plural(item.openSubscriptions, 'assinatura de aula', 'assinaturas de aula'));
  if (item.upcomingClassAttendances > 0)
    parts.push(
      plural(item.upcomingClassAttendances, 'presença futura em aula', 'presenças futuras em aula'),
    );
  if (item.openCharges > 0)
    parts.push(
      `${plural(item.openCharges, 'mensalidade em aberto', 'mensalidades em aberto')} (${formatMoney(item.openChargesCents)})`,
    );
  if (item.bookingsDueCents > 0)
    parts.push(`${formatMoney(item.bookingsDueCents)} a receber de reservas`);
  return parts;
}

export type PendingLine = { spaceId: string; spaceName: string; text: string };

/** Uma linha por espaço que tem pendência (espaços sem nada ficam de fora). */
export function pendingLines(items: readonly DeletionRequestPendingItem[] | null): PendingLine[] {
  return (items ?? [])
    .map((item) => ({
      spaceId: item.spaceId,
      spaceName: item.spaceName,
      text: pendingParts(item).join(', '),
    }))
    .filter((line) => line.text !== '');
}
