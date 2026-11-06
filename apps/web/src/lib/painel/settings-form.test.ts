import { describe, expect, it } from 'vitest';
import { type SettingsDraft, settingsFromDraft } from './settings-form';

const valid: SettingsDraft = {
  pricePerHour: '120,00',
  minDuration: '60',
  maxDuration: '180',
  minAdvance: '60',
  windowDays: '30',
  cancellationDeadline: '60',
  attendanceMode: 'AUTOMATIC',
  attendanceOpenBefore: '1440',
  attendanceCloseBefore: '60',
  attendanceCancelDeadline: '120',
  pastDueBlockEnabled: true,
  pastDueBlockDays: '7',
  methods: ['PIX', 'CARD'],
};

describe('settingsFromDraft', () => {
  it('converte reais em centavos e mantém os demais campos', () => {
    const result = settingsFromDraft(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.pricePerHourCents).toBe(12000);
      expect(result.data.bookingMaxDurationMin).toBe(180);
    }
  });

  it('exige múltiplos de 30 e mínimo <= máximo', () => {
    const odd = settingsFromDraft({ ...valid, minDuration: '45' });
    expect(odd.ok === false && odd.errors.minDuration).toMatch(/30/);
    const swapped = settingsFromDraft({ ...valid, minDuration: '240' });
    expect(swapped.ok === false && swapped.errors.minDuration).toMatch(/mínima/);
  });

  it('valida formas de pagamento e lista de presença', () => {
    const r = settingsFromDraft({
      ...valid,
      methods: [],
      attendanceOpenBefore: '30',
      attendanceCloseBefore: '60',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.methods).toBeDefined();
      expect(r.errors.attendanceCloseBefore).toBeDefined();
    }
  });

  it('o preço por hora é obrigatório e não envia campos de mensalidade', () => {
    const ok = settingsFromDraft(valid);
    expect(ok.ok && Object.keys(ok.data)).not.toContain('recurringMonthlyPriceCents');
    expect(ok.ok && Object.keys(ok.data)).not.toContain('recurringBillingDay');

    const priceEmpty = settingsFromDraft({ ...valid, pricePerHour: '  ' });
    expect(priceEmpty.ok).toBe(false);
    if (!priceEmpty.ok) expect(priceEmpty.errors.pricePerHour).toMatch(/Informe/);

    const priceInvalid = settingsFromDraft({ ...valid, pricePerHour: 'abc' });
    expect(priceInvalid.ok === false && priceInvalid.errors.pricePerHour).toBe('Valor inválido');
  });

  it('envia a regra de bloqueio por atraso', () => {
    const r = settingsFromDraft(valid);
    expect(r.ok && r.data).toMatchObject({
      pastDueBlockEnabled: true,
      pastDueBlockDays: 7,
    });
  });

  it('com o bloqueio por atraso desligado não valida nem envia os dias', () => {
    const r = settingsFromDraft({ ...valid, pastDueBlockEnabled: false, pastDueBlockDays: '' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.pastDueBlockEnabled).toBe(false);
      expect(Object.keys(r.data)).not.toContain('pastDueBlockDays');
    }
    const on = settingsFromDraft({ ...valid, pastDueBlockDays: '0' });
    expect(on.ok === false && on.errors.pastDueBlockDays).toBeDefined();
  });

  it('no modo manual não valida nem envia os tempos de abertura e fechamento', () => {
    const r = settingsFromDraft({
      ...valid,
      attendanceMode: 'MANUAL',
      attendanceOpenBefore: '',
      attendanceCloseBefore: '99999',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.data)).not.toContain('attendanceOpenBeforeMin');
      expect(Object.keys(r.data)).not.toContain('attendanceCloseBeforeMin');
      expect(r.data.attendanceCancelDeadlineMin).toBe(120);
    }
  });

  it('o prazo vale de 0 minutos a 30 dias, com o erro em linguagem de gente', () => {
    const r = settingsFromDraft({ ...valid, minAdvance: '43201', attendanceOpenBefore: '' });
    expect(r.ok === false && r.errors.minAdvance).toBe('Use de 0 minutos a 30 dias');
    expect(r.ok === false && r.errors.attendanceOpenBefore).toBe('Use de 0 minutos a 30 dias');
    expect(settingsFromDraft({ ...valid, minAdvance: '43200' }).ok).toBe(true);
  });
});
