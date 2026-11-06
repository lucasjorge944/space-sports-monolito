import type { ClassGroup, Plan } from '@space-sports/api-client';
import { describe, expect, it } from 'vitest';
import {
  type ClassGroupDraft,
  classGroupFromDraft,
  draftFromClassGroup,
  draftFromPlan,
  emptyClassGroupDraft,
  emptyPlanDraft,
  endTimeLabel,
  formatClassSlot,
  frequencyLabel,
  type PlanDraft,
  planFromDraft,
  UNLIMITED,
} from './aulas';

const validGroup: ClassGroupDraft = {
  ...emptyClassGroupDraft(),
  name: ' Futevôlei Iniciante ',
  courtId: 'court-1',
  sportId: 'sport-1',
  teacherMemberIds: ['member-1'],
  capacity: '12',
};

describe('endTimeLabel / formatClassSlot', () => {
  it('soma a duração ao início', () => {
    expect(endTimeLabel('19:00', 90)).toBe('20:30');
    expect(endTimeLabel('08:30', 30)).toBe('09:00');
  });

  it('volta ao começo do dia ao passar da meia-noite', () => {
    expect(endTimeLabel('23:30', 60)).toBe('00:30');
  });

  it('monta o horário da turma', () => {
    expect(formatClassSlot({ weekday: 2, startTime: '19:00', durationMin: 60 })).toBe(
      'Ter · 19:00–20:00',
    );
  });
});

describe('classGroupFromDraft', () => {
  it('monta o corpo da API a partir do formulário', () => {
    const result = classGroupFromDraft(validGroup);
    expect(result).toEqual({
      ok: true,
      data: {
        name: 'Futevôlei Iniciante',
        sportId: 'sport-1',
        level: null,
        teacherMemberIds: ['member-1'],
        courtId: 'court-1',
        weekday: 1,
        startTime: '19:00',
        durationMin: 60,
        capacity: 12,
        active: true,
      },
    });
  });

  it('envia o nível quando escolhido', () => {
    const result = classGroupFromDraft({ ...validGroup, level: 'ADVANCED' });
    expect(result.ok && result.data.level).toBe('ADVANCED');
  });

  it('exige os campos obrigatórios', () => {
    const result = classGroupFromDraft(emptyClassGroupDraft());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual([
        'capacity',
        'courtId',
        'name',
        'sportId',
        'teacherMemberIds',
      ]);
    }
  });

  it('exige duração em múltiplos de 30 minutos', () => {
    const odd = classGroupFromDraft({ ...validGroup, durationMin: '45' });
    expect(odd.ok === false && odd.errors.durationMin).toMatch(/30/);
    const big = classGroupFromDraft({ ...validGroup, durationMin: '390' });
    expect(big.ok).toBe(false);
  });

  it('limita a capacidade de 1 a 100 e ao piso das matrículas', () => {
    expect(classGroupFromDraft({ ...validGroup, capacity: '0' }).ok).toBe(false);
    expect(classGroupFromDraft({ ...validGroup, capacity: '101' }).ok).toBe(false);
    const below = classGroupFromDraft({ ...validGroup, capacity: '5' }, 8);
    expect(below.ok === false && below.errors.capacity).toMatch(/8 aluno/);
    expect(classGroupFromDraft({ ...validGroup, capacity: '8' }, 8).ok).toBe(true);
  });

  it('recusa horário fora da grade de 30 minutos', () => {
    const result = classGroupFromDraft({ ...validGroup, startTime: '19:15' });
    expect(result.ok === false && result.errors.startTime).toBeDefined();
  });
});

describe('draftFromClassGroup', () => {
  it('preenche o formulário com a turma existente', () => {
    const group = {
      id: 'g1',
      name: 'Turma',
      sport: { id: 's1', name: 'Futevôlei', slug: 'futevolei' },
      level: 'BEGINNER',
      teachers: [
        { memberId: 'm1', userId: 'u1', name: 'Prof', avatarUrl: null },
        { memberId: 'm2', userId: 'u2', name: 'Prof Dois', avatarUrl: null },
      ],
      court: { id: 'c1', name: 'Quadra 1' },
      weekday: 4,
      startTime: '07:30',
      durationMin: 90,
      capacity: 10,
      active: false,
      enrolledCount: 3,
      availableSpots: 7,
      createdAt: '2026-10-01T12:00:00.000Z',
    } satisfies ClassGroup;
    expect(draftFromClassGroup(group)).toMatchObject({
      courtId: 'c1',
      sportId: 's1',
      level: 'BEGINNER',
      teacherMemberIds: ['m1', 'm2'],
      weekday: '4',
      startTime: '07:30',
      durationMin: '90',
      capacity: '10',
      active: false,
    });
  });
});

const validPlan: PlanDraft = {
  ...emptyPlanDraft(),
  name: 'Futevôlei 2x/semana',
  sportId: 'sport-1',
  price: '180,00',
};

describe('planFromDraft', () => {
  it('converte reais em centavos e a frequência em número', () => {
    const result = planFromDraft(validPlan);
    expect(result).toEqual({
      ok: true,
      data: {
        name: 'Futevôlei 2x/semana',
        sportId: 'sport-1',
        weeklyFrequency: 2,
        priceCents: 18000,
        billingDay: 10,
        active: true,
      },
    });
  });

  it('ilimitado vira frequência nula', () => {
    const result = planFromDraft({ ...validPlan, frequency: UNLIMITED });
    expect(result.ok && result.data.weeklyFrequency).toBeNull();
  });

  it('limita o vencimento ao dia 1 a 28', () => {
    expect(planFromDraft({ ...validPlan, billingDay: '0' }).ok).toBe(false);
    expect(planFromDraft({ ...validPlan, billingDay: '29' }).ok).toBe(false);
    expect(planFromDraft({ ...validPlan, billingDay: '28' }).ok).toBe(true);
  });

  it('exige nome, esporte e valor', () => {
    const result = planFromDraft(emptyPlanDraft());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['name', 'price', 'sportId']);
  });

  it('aceita valor zero (plano gratuito) mas recusa texto inválido', () => {
    expect(planFromDraft({ ...validPlan, price: '0' }).ok).toBe(true);
    expect(planFromDraft({ ...validPlan, price: 'abc' }).ok).toBe(false);
  });
});

describe('draftFromPlan e rótulos', () => {
  const plan = {
    id: 'p1',
    name: 'Plano',
    sport: { id: 's1', name: 'Futevôlei', slug: 'futevolei' },
    weeklyFrequency: null,
    priceCents: 15050,
    billingDay: 5,
    active: true,
    createdAt: '2026-10-01T12:00:00.000Z',
  } satisfies Plan;

  it('preenche o formulário com o plano existente', () => {
    expect(draftFromPlan(plan)).toMatchObject({
      frequency: UNLIMITED,
      price: '150,50',
      billingDay: '5',
    });
  });

  it('descreve a frequência', () => {
    expect(frequencyLabel(null)).toBe('Ilimitado');
    expect(frequencyLabel(3)).toBe('3x por semana');
  });
});
