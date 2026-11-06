import type { SpaceStatus } from '@space-sports/api-client';

export type SpaceStatusAction = 'suspend' | 'reactivate' | 'close';

/** Transições permitidas pela API (RF-SUPER-03): suspender e reativar (de suspenso ou encerrado) ou encerrar. */
export function availableStatusActions(status: SpaceStatus): SpaceStatusAction[] {
  switch (status) {
    case 'ACTIVE':
      return ['suspend', 'close'];
    case 'SUSPENDED':
      return ['reactivate', 'close'];
    case 'CLOSED':
      return ['reactivate'];
  }
}
