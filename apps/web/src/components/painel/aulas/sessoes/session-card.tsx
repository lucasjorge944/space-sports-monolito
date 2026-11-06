import type { ClassSession } from '@space-sports/api-client';
import { Clock, Hourglass, MapPin, UserRound, Users } from 'lucide-react';
import Link from 'next/link';
import { StatusBadge } from '@/components/painel/status-badge';
import { formatTime } from '@/lib/format';
import { teacherNames, teachersLabel } from '@/lib/painel/aulas';
import { isFull, occupancyLabel, SESSION_STATUS } from '@/lib/painel/sessions';
import { cn, focusRing } from '@/lib/utils';

/** Cartão de uma aula no calendário/lista; leva ao detalhe com a lista de presença. */
export function SessionCard({ session }: { session: ClassSession }) {
  const cancelled = session.status === 'CANCELLED';
  return (
    <Link
      href={`/painel/aulas/sessoes/${session.id}`}
      data-testid="session-card"
      className={cn(
        'bg-card hover:bg-accent flex flex-col gap-2 rounded-lg border p-3 text-sm transition-colors',
        focusRing,
        cancelled && 'opacity-70',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1 font-medium">
          <Clock className="size-3.5" aria-hidden />
          {formatTime(session.startsAt)}–{formatTime(session.endsAt)}
        </span>
        <StatusBadge info={SESSION_STATUS[session.status]} />
      </div>
      <p className={cn('font-medium', cancelled && 'line-through')}>{session.classGroup.name}</p>
      <dl className="text-muted-foreground flex flex-col gap-1 text-xs">
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">{teachersLabel(session.teachers)}</dt>
          <UserRound className="size-3.5 shrink-0" aria-hidden />
          <dd>{teacherNames(session.teachers)}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Quadra</dt>
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <dd>{session.court.name}</dd>
        </div>
        {cancelled ? null : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Vagas ocupadas</dt>
              <Users className="size-3.5 shrink-0" aria-hidden />
              <dd className={cn(isFull(session) && 'text-foreground font-medium')}>
                {occupancyLabel(session)} vagas
              </dd>
            </div>
            {session.waitlistCount > 0 ? (
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Na espera</dt>
                <Hourglass className="size-3.5 shrink-0" aria-hidden />
                <dd>{session.waitlistCount} na espera</dd>
              </div>
            ) : null}
          </div>
        )}
      </dl>
    </Link>
  );
}
