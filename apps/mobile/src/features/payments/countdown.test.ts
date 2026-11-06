import {
  clockOffset,
  countdownA11yLabel,
  countdownAnnouncement,
  formatClock,
  formatDeadline,
  formatLongCountdown,
  holdMinutes,
  isUrgent,
  remainingMs,
  resetServerClock,
  serverNow,
  syncServerClock,
} from './countdown';

afterEach(() => resetServerClock());

describe('relógio do servidor (docs/05, princípio 4)', () => {
  it('a diferença vem do serverTime da resposta, não do relógio do aparelho', () => {
    const receivedAt = Date.parse('2026-11-08T21:30:00.000Z');
    // Aparelho 2 min adiantado: o servidor diz 21:28.
    expect(clockOffset('2026-11-08T21:28:00.000Z', receivedAt)).toBe(-120_000);
  });

  it('com o aparelho adiantado, a contagem não encurta o prazo', () => {
    const device = Date.parse('2026-11-08T21:32:00.000Z');
    syncServerClock('2026-11-08T21:30:00.000Z', device);
    // Pix até 21:45 no servidor: faltam 15 min, não 13.
    expect(remainingMs('2026-11-08T21:45:00.000Z', serverNow(device))).toBe(15 * 60_000);
  });

  it('serverTime inválido ou ausente não muda a diferença', () => {
    syncServerClock(undefined);
    syncServerClock('lixo', 0);
    expect(serverNow(1000)).toBe(1000);
  });

  it('prazo vencido conta zero, nunca negativo', () => {
    expect(remainingMs('2026-11-08T21:00:00.000Z', Date.parse('2026-11-08T21:05:00.000Z'))).toBe(0);
  });
});

describe('formato da contagem', () => {
  it('mm:ss na reserva', () => {
    expect(formatClock(14 * 60_000 + 32_000)).toBe('14:32');
    expect(formatClock(999)).toBe('00:01');
    expect(formatClock(0)).toBe('00:00');
  });

  it('mensalidade: horas e minutos acima de 1 h, mm:ss abaixo', () => {
    expect(formatLongCountdown(23 * 3600_000 + 41 * 60_000 + 20_000)).toBe('23 h 41 min');
    expect(formatLongCountdown(2 * 3600_000)).toBe('2 h');
    expect(formatLongCountdown(59 * 60_000)).toBe('59:00');
  });

  it('urgente abaixo de 3 min (reserva) e de 1 h (mensalidade)', () => {
    expect(isUrgent(3 * 60_000, 'booking')).toBe(true);
    expect(isUrgent(3 * 60_000 + 1000, 'booking')).toBe(false);
    expect(isUrgent(59 * 60_000, 'classCharge')).toBe(true);
    expect(isUrgent(2 * 3600_000, 'classCharge')).toBe(false);
    expect(isUrgent(0, 'booking')).toBe(false);
  });

  it('o rótulo de acessibilidade muda só a cada minuto', () => {
    expect(countdownA11yLabel(14 * 60_000 + 32_000)).toBe('Faltam 15 minutos para pagar');
    expect(countdownA11yLabel(14 * 60_000 + 1_000)).toBe('Faltam 15 minutos para pagar');
    expect(countdownA11yLabel(14 * 60_000)).toBe('Faltam 14 minutos para pagar');
    expect(countdownA11yLabel(30_000)).toBe('Falta 1 minuto para pagar');
    expect(countdownA11yLabel(0)).toBe('O prazo para pagar acabou');
  });

  it('anuncia aos 5 min e a 1 min, uma vez', () => {
    expect(countdownAnnouncement(5 * 60_000 + 500, 5 * 60_000 - 500)).toBe(
      'Faltam 5 minutos para pagar',
    );
    expect(countdownAnnouncement(5 * 60_000 - 500, 5 * 60_000 - 1500)).toBeNull();
    expect(countdownAnnouncement(60_500, 59_500)).toBe('Falta 1 minuto para pagar');
  });

  it('prazo em hora de relógio no fuso do espaço: hoje, amanhã ou a data', () => {
    const now = Date.parse('2026-11-08T21:30:00.000Z'); // 18:30 em São Paulo
    expect(formatDeadline('2026-11-08T21:47:00.000Z', 'America/Sao_Paulo', now)).toBe('18:47');
    expect(formatDeadline('2026-11-09T13:15:00.000Z', 'America/Sao_Paulo', now)).toBe(
      'amanhã, 10:15',
    );
    expect(formatDeadline('2026-11-12T13:15:00.000Z', 'America/Sao_Paulo', now)).toBe(
      '12/11, 10:15',
    );
  });
});

describe('horário guardado (RN-ONPAY-02)', () => {
  const now = Date.parse('2026-11-08T21:00:00.000Z');
  it('15 min, ou até o início se ele vier antes', () => {
    expect(holdMinutes('2026-11-08T23:00:00.000Z', now)).toBe(15);
    expect(holdMinutes('2026-11-08T21:09:30.000Z', now)).toBe(9);
    expect(holdMinutes('2026-11-08T20:00:00.000Z', now)).toBe(0);
  });
});
