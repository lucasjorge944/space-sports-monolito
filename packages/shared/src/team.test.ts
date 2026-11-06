import { describe, expect, it } from 'vitest';
import { inviteStaffSchema, replaceMemberRolesSchema } from './team';

describe('inviteStaffSchema', () => {
  it('aceita Admin e Professor', () => {
    for (const role of ['ADMIN', 'TEACHER']) {
      expect(inviteStaffSchema.safeParse({ email: 'a@exemplo.com', role }).success).toBe(true);
    }
  });

  it('não aceita o Dono (só o Super concede) nem e-mail inválido', () => {
    expect(inviteStaffSchema.safeParse({ email: 'a@exemplo.com', role: 'OWNER' }).success).toBe(
      false,
    );
    expect(inviteStaffSchema.safeParse({ email: 'sem-arroba', role: 'ADMIN' }).success).toBe(false);
  });
});

describe('replaceMemberRolesSchema', () => {
  it('exige ao menos um papel e rejeita repetidos', () => {
    expect(replaceMemberRolesSchema.safeParse({ roles: [] }).success).toBe(false);
    expect(replaceMemberRolesSchema.safeParse({ roles: ['ADMIN', 'ADMIN'] }).success).toBe(false);
    expect(replaceMemberRolesSchema.safeParse({ roles: ['ADMIN', 'TEACHER'] }).success).toBe(true);
  });
});
