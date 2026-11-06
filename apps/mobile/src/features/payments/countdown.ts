import { BOOKING_PAYMENT_HOLD_MIN, utcToZoned } from '@space-sports/shared';
import { paymentLayout } from '@space-sports/ui-tokens';
import { formatTime, todayIn } from '@/lib/datetime';

/**
 * Relógio do servidor (docs/05, "Pagamento online", princípio 4): o vencimento é do servidor. A cada
 * resposta com `serverTime`, guardamos a diferença para o relógio do aparelho; a contagem usa
 * `agora do aparelho + diferença`, para um celular com a hora errada não mostrar prazo falso.
 */
let offsetMs = 0;

/** Diferença servidor − aparelho de uma resposta (`receivedAt` = quando ela chegou). */
export function clockOffset(serverTime: string, receivedAt: number): number {
  const server = new Date(serverTime).getTime();
  return Number.isFinite(server) ? server - receivedAt : 0;
}

/** Guarda a diferença da resposta mais recente (usada também onde não há `serverTime`). */
export function syncServerClock(serverTime: string | null | undefined, receivedAt = Date.now()) {
  if (serverTime) offsetMs = clockOffset(serverTime, receivedAt);
}

/**
 * Diferença servidor − aparelho de uma resposta já em cache: o `serverTime` dela e a hora em que
 * chegou (`dataUpdatedAt` do TanStack Query). Nula sem os dois.
 */
export function responseOffset(
  serverTime: string | null | undefined,
  receivedAt: number | null | undefined,
): number | null {
  return serverTime && receivedAt ? clockOffset(serverTime, receivedAt) : null;
}

/** Agora, no relógio do servidor. */
export function serverNow(deviceNow = Date.now()): number {
  return deviceNow + offsetMs;
}

/** Agora no relógio do servidor, pela diferença de uma resposta (ou pela última cobrança). */
export function nowWithOffset(offsetMs: number | null | undefined, deviceNow = Date.now()): number {
  return offsetMs == null ? serverNow(deviceNow) : deviceNow + offsetMs;
}

/** Só para os testes. */
export function resetServerClock() {
  offsetMs = 0;
}

/** Quanto falta (ms, nunca negativo) até `deadline`, no relógio do servidor. */
export function remainingMs(deadline: string, now = serverNow()): number {
  return Math.max(new Date(deadline).getTime() - now, 0);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 872_000 → "14:32"; a partir de 1 h, "1:05:00" (só o formato mm:ss da tela usa isto). */
export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Mensalidade (24 h): "23 h 41 min" acima de 1 h; abaixo, mm:ss. */
export function formatLongCountdown(ms: number): string {
  if (ms < 60 * 60_000) return formatClock(ms);
  const totalMin = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

export type CountdownKind = 'booking' | 'classCharge';

/** Abaixo de 3 min (reserva) ou 1 h (mensalidade) a contagem vira alerta. */
export function isUrgent(ms: number, kind: CountdownKind): boolean {
  return ms > 0 && ms <= paymentLayout.countdownUrgentMs[kind];
}

/**
 * Rótulo de acessibilidade da contagem: muda só a cada minuto ("Faltam 14 minutos para pagar"),
 * nunca a cada segundo.
 */
export function countdownA11yLabel(ms: number): string {
  if (ms <= 0) return 'O prazo para pagar acabou';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes >= 120) {
    const hours = Math.floor(minutes / 60);
    return `Faltam ${hours} horas para pagar`;
  }
  return minutes === 1 ? 'Falta 1 minuto para pagar' : `Faltam ${minutes} minutos para pagar`;
}

/** Anúncios aos 5 min e a 1 min (o minuto que acabou de começar). */
export function countdownAnnouncement(previousMs: number, ms: number): string | null {
  for (const mark of [5, 1]) {
    const at = mark * 60_000;
    if (previousMs > at && ms <= at && ms > 0) {
      return mark === 1 ? 'Falta 1 minuto para pagar' : `Faltam ${mark} minutos para pagar`;
    }
  }
  return null;
}

/**
 * Hora de relógio do prazo: "18:47"; noutro dia, "amanhã, 10:15" ou "08/11, 10:15" (no fuso do
 * espaço, America/Sao_Paulo por padrão).
 */
export function formatDeadline(iso: string, timeZone?: string, now = serverNow()): string {
  const time = formatTime(iso, timeZone);
  const zone = timeZone ?? 'America/Sao_Paulo';
  const day = utcToZoned(new Date(iso), zone).date;
  const today = todayIn(zone, new Date(now));
  if (day === today) return time;
  const tomorrow = todayIn(zone, new Date(now + 24 * 3600_000));
  if (day === tomorrow) return `amanhã, ${time}`;
  return `${day.slice(8, 10)}/${day.slice(5, 7)}, ${time}`;
}

/**
 * Minutos que o horário fica guardado numa reserva obrigatória criada agora (RN-ONPAY-02):
 * `min(início, agora + 15 min)`, no relógio do servidor.
 */
export function holdMinutes(startsAt: string, now = serverNow()): number {
  const untilStart = Math.floor((new Date(startsAt).getTime() - now) / 60_000);
  return Math.max(Math.min(BOOKING_PAYMENT_HOLD_MIN, untilStart), 0);
}
