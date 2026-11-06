import { describe, expect, it } from 'vitest';
import { canManageMember, rolesToSave, teacherRemoval } from './team';

describe('team', () => {
  const admin = { userId: 'a', roles: ['ADMIN'] as const };
  const owner = { userId: 'o', roles: ['OWNER'] as const };

  it('não permite mexer em si mesmo nem no Dono (exceto sendo Dono)', () => {
    expect(canManageMember(admin, { userId: 'a', roles: ['ADMIN'] })).toBe(false);
    expect(canManageMember(admin, { userId: 'o', roles: ['OWNER'] })).toBe(false);
    expect(canManageMember(admin, { userId: 't', roles: ['TEACHER'] })).toBe(true);
    expect(canManageMember(owner, { userId: 'x', roles: ['OWNER', 'ADMIN'] })).toBe(true);
  });

  it('preserva o papel de Dono e ordena os papéis', () => {
    expect(rolesToSave({ roles: ['OWNER'] }, ['TEACHER', 'ADMIN'])).toEqual([
      'OWNER',
      'ADMIN',
      'TEACHER',
    ]);
    expect(rolesToSave({ roles: ['TEACHER'] }, ['ADMIN', 'OWNER'])).toEqual(['ADMIN']);
  });

  it('quem só é Professor sai da equipe; quem tem outro papel perde só o de Professor', () => {
    expect(teacherRemoval({ roles: ['TEACHER'] })).toEqual({ kind: 'remove' });
    expect(teacherRemoval({ roles: ['ADMIN', 'TEACHER'] })).toEqual({
      kind: 'drop-role',
      roles: ['ADMIN'],
    });
    expect(teacherRemoval({ roles: ['OWNER', 'TEACHER'] })).toEqual({
      kind: 'drop-role',
      roles: ['OWNER'],
    });
  });
});
