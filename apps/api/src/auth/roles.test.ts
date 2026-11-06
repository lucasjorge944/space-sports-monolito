import { PLATFORM_ROLES, SPACE_ROLES, SPACE_STATUSES } from '@space-sports/shared';
import { describe, expect, it } from 'vitest';
import { platformRole, spaceMemberRole, spaceStatus } from '../db/schema/enums.js';

// Os papéis do contrato (@space-sports/shared) são os mesmos enums do banco.
describe('papéis compartilhados x enums do banco', () => {
  it('platform_role', () => {
    expect(platformRole.enumValues).toEqual([...PLATFORM_ROLES]);
  });

  it('space_member_role', () => {
    expect(spaceMemberRole.enumValues).toEqual([...SPACE_ROLES]);
  });

  it('space_status', () => {
    expect(spaceStatus.enumValues).toEqual([...SPACE_STATUSES]);
  });
});
