import { describe, expect, it } from 'vitest';
import {
  availableSpots,
  createClassGroupSchema,
  createPlanSchema,
  MAX_CLASS_TEACHERS,
  updateClassGroupSchema,
  updateClassSessionSchema,
  weeklySlotsOverlap,
  zonedWeeklySlotsOverlap,
} from './classes';

const uuid = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

describe('weeklySlotsOverlap', () => {
  it('detecta sobreposição no mesmo dia', () => {
    const a = { weekday: 1, startTime: '18:00', durationMin: 60 };
    expect(weeklySlotsOverlap(a, { weekday: 1, startTime: '18:30', durationMin: 60 })).toBe(true);
    expect(weeklySlotsOverlap(a, { weekday: 1, startTime: '17:00', durationMin: 90 })).toBe(true);
  });

  it('horários adjacentes ou em outro dia não conflitam', () => {
    const a = { weekday: 1, startTime: '18:00', durationMin: 60 };
    expect(weeklySlotsOverlap(a, { weekday: 1, startTime: '19:00', durationMin: 60 })).toBe(false);
    expect(weeklySlotsOverlap(a, { weekday: 1, startTime: '17:00', durationMin: 60 })).toBe(false);
    expect(weeklySlotsOverlap(a, { weekday: 2, startTime: '18:00', durationMin: 60 })).toBe(false);
  });

  it('considera a aula que passa da meia-noite, inclusive de sábado para domingo', () => {
    const late = { weekday: 6, startTime: '23:30', durationMin: 60 };
    expect(weeklySlotsOverlap(late, { weekday: 0, startTime: '00:00', durationMin: 30 })).toBe(
      true,
    );
    expect(weeklySlotsOverlap({ weekday: 0, startTime: '00:00', durationMin: 30 }, late)).toBe(
      true,
    );
    expect(weeklySlotsOverlap(late, { weekday: 0, startTime: '00:30', durationMin: 30 })).toBe(
      false,
    );
  });
});

describe('zonedWeeklySlotsOverlap (decisão 37)', () => {
  const at = new Date('2026-11-02T12:00:00Z');
  it('compara cada horário no fuso do próprio espaço', () => {
    // 18:00 em São Paulo (UTC−3) = 17:00 em Manaus (UTC−4).
    const sp = { weekday: 1, startTime: '18:00', durationMin: 60, timeZone: 'America/Sao_Paulo' };
    const manaus = { weekday: 1, startTime: '17:00', durationMin: 60, timeZone: 'America/Manaus' };
    expect(zonedWeeklySlotsOverlap(sp, manaus, at)).toBe(true);
    expect(zonedWeeklySlotsOverlap(sp, { ...manaus, startTime: '18:00' }, at)).toBe(false);
    expect(zonedWeeklySlotsOverlap(sp, { ...sp, startTime: '18:30' }, at)).toBe(true);
  });

  it('considera a virada da semana entre fusos', () => {
    // Sábado 23:30 em Manaus = domingo 00:30 em São Paulo.
    const manaus = { weekday: 6, startTime: '23:30', durationMin: 60, timeZone: 'America/Manaus' };
    const sp = { weekday: 0, startTime: '00:30', durationMin: 30, timeZone: 'America/Sao_Paulo' };
    expect(zonedWeeklySlotsOverlap(manaus, sp, at)).toBe(true);
    expect(zonedWeeklySlotsOverlap(manaus, { ...sp, startTime: '01:30' }, at)).toBe(false);
  });
});

describe('schemas de aulas', () => {
  const group = {
    name: 'Futevôlei iniciante',
    sportId: uuid,
    teacherMemberIds: [uuid],
    courtId: uuid,
    weekday: 2,
    startTime: '19:00',
    durationMin: 60,
    capacity: 8,
  };

  it('professores: ao menos um, sem repetir, na turma e na sessão (decisão 47)', () => {
    const other = '01890a5d-ac96-774b-bcce-b302099a8057';
    const lists = [
      createClassGroupSchema,
      updateClassGroupSchema,
      updateClassSessionSchema,
    ] as const;
    for (const schema of lists) {
      const body = (teacherMemberIds: string[]) =>
        schema === createClassGroupSchema ? { ...group, teacherMemberIds } : { teacherMemberIds };
      expect(schema.safeParse(body([uuid, other])).success).toBe(true);
      expect(schema.safeParse(body([])).success).toBe(false);
      expect(schema.safeParse(body([uuid, uuid])).success).toBe(false);
      expect(schema.safeParse(body(Array(MAX_CLASS_TEACHERS + 1).fill(uuid))).success).toBe(false);
    }
    expect(createClassGroupSchema.safeParse({ ...group, teacherMemberId: uuid }).success).toBe(
      false,
    );
  });

  it('turma: duração múltipla de 30 min e horário em meia hora', () => {
    expect(createClassGroupSchema.parse(group)).toMatchObject({ level: null, active: true });
    expect(createClassGroupSchema.safeParse({ ...group, durationMin: 45 }).success).toBe(false);
    expect(createClassGroupSchema.safeParse({ ...group, startTime: '19:15' }).success).toBe(false);
    expect(createClassGroupSchema.safeParse({ ...group, capacity: 0 }).success).toBe(false);
    expect(updateClassGroupSchema.safeParse({}).success).toBe(false);
  });

  it('plano: vencimento entre 1 e 28 e frequência nula = ilimitado', () => {
    const plan = {
      name: '2x',
      sportId: uuid,
      weeklyFrequency: 2,
      priceCents: 18_000,
      billingDay: 10,
    };
    expect(createPlanSchema.parse(plan)).toMatchObject({ active: true });
    expect(createPlanSchema.safeParse({ ...plan, weeklyFrequency: null }).success).toBe(true);
    expect(createPlanSchema.safeParse({ ...plan, billingDay: 29 }).success).toBe(false);
    expect(createPlanSchema.safeParse({ ...plan, billingDay: 0 }).success).toBe(false);
  });

  it('vagas nunca negativas', () => {
    expect(availableSpots(8, 3)).toBe(5);
    expect(availableSpots(2, 3)).toBe(0);
  });
});
