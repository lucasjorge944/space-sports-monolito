import type { SpaceStatus } from '@space-sports/api-client';
import type { UserStatus } from '@space-sports/shared';
import { Badge } from '@/components/ui/badge';
import { spaceStatusLabel, userStatusLabel } from '@/lib/super/labels';

export function SpaceStatusBadge({ status }: { status: SpaceStatus }) {
  const variant = status === 'ACTIVE' ? 'success' : status === 'SUSPENDED' ? 'warning' : 'muted';
  return <Badge variant={variant}>{spaceStatusLabel[status]}</Badge>;
}

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const variant = status === 'ACTIVE' ? 'success' : status === 'BLOCKED' ? 'destructive' : 'muted';
  return <Badge variant={variant}>{userStatusLabel[status]}</Badge>;
}

/** Telefone do cadastro, sem verificação por SMS (decisão 64): não prova identidade. */
export function PhoneUnverifiedBadge() {
  return (
    <Badge variant="muted" title="Informado no cadastro, sem verificação por SMS">
      Não verificado
    </Badge>
  );
}
