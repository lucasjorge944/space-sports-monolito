import { describe, expect, it } from 'vitest';
import { canInSpace, meResponseSchema, SPACE_PERMISSIONS, type SpaceRole } from './auth';

const roles = ['OWNER', 'ADMIN', 'TEACHER'] as const satisfies SpaceRole[];

/** Quem pode cada ação, na ordem Dono, Admin, Professor (docs/02). */
const matrix: Record<keyof typeof SPACE_PERMISSIONS, [boolean, boolean, boolean]> = {
  'space.edit': [true, true, false],
  'team.manage': [true, true, false],
  'settings.manage': [true, true, false],
  'schedule.view': [true, true, true],
  'booking.create': [true, true, false],
  'payment.record': [true, true, false],
  'charge.waive': [true, true, false],
  'classes.manage': [true, true, false],
  'classes.view': [true, true, true],
  'enrollment.manage': [true, true, false],
  'attendance.manage': [true, true, true],
  'tournament.manage': [true, true, false],
  'score.record': [true, true, true],
  'reports.financial': [true, true, false],
  'contact.view': [true, true, false],
  'merchant.manage': [true, false, false],
  'payments.online.manage': [true, true, false],
  'review.view': [true, true, true],
  'review.reply': [true, true, false],
};

describe('SPACE_PERMISSIONS (matriz de permissões do painel do espaço)', () => {
  it.each(Object.entries(matrix))('%s', (permission, expected) => {
    const key = permission as keyof typeof SPACE_PERMISSIONS;
    expect(roles.map((role) => canInSpace([role], key))).toEqual(expected);
  });

  it('cobre todas as ações da matriz', () => {
    expect(Object.keys(SPACE_PERMISSIONS).sort()).toEqual(Object.keys(matrix).sort());
  });

  it('basta um dos papéis do usuário no espaço permitir', () => {
    expect(canInSpace(['TEACHER', 'ADMIN'], 'booking.create')).toBe(true);
    expect(canInSpace(['TEACHER'], 'booking.create')).toBe(false);
    expect(canInSpace([], 'schedule.view')).toBe(false);
  });
});

describe('meResponseSchema', () => {
  it('aceita usuário só com telefone e sem vínculos', () => {
    const me = {
      id: '0192f3a4-5b6c-7d8e-9f01-23456789abcd',
      name: '',
      email: null,
      emailVerified: false,
      phone: '+5531999998888',
      phoneVerified: true,
      avatarUrl: null,
      birthDate: null,
      gender: null,
      favoriteSports: [],
      profile: { missing: ['name'] },
      platformRole: 'USER',
      memberships: [],
      access: { super: false, management: false },
    };
    expect(meResponseSchema.parse(me)).toEqual(me);
  });
});
