import {
  bookingDates,
  formatBookingWhen,
  formatDate,
  formatDateTime,
  formatDayCompact,
  formatDayLong,
  formatDayShort,
  formatDistance,
  formatDuration,
  formatInstantDate,
  formatMonthYear,
  formatTime,
  halfHourSlots,
  openingWindowMinutes,
  todayIn,
} from './datetime';

describe('datetime', () => {
  it('mostra a hora no fuso de São Paulo, não no do aparelho', () => {
    expect(formatTime('2026-11-02T13:00:00.000Z')).toBe('10:00');
    expect(formatTime('2026-11-03T02:30:00.000Z')).toBe('23:30');
  });

  it('formata o dia sem deslocar pelo fuso', () => {
    expect(formatDate('2026-11-02')).toBe('02/11/2026');
    expect(formatDayShort('2026-11-02')).toBe('Seg, 02/11/2026');
    expect(formatDayLong('2026-12-25')).toBe('Sexta, 25/12/2026');
    expect(formatDayCompact('2026-11-02')).toBe('Seg, 02/11');
  });

  it('formata o intervalo da reserva no fuso do espaço (virada do dia em UTC)', () => {
    expect(formatBookingWhen('2026-11-03T01:00:00.000Z', '2026-11-03T02:00:00.000Z')).toBe(
      'Seg, 02/11/2026 · 22:00 – 23:00',
    );
  });

  it('formata data e hora no fuso do espaço (virada do dia)', () => {
    // 02:00Z de 30/10 ainda é 29/10 às 23:00 em São Paulo.
    expect(formatDateTime('2026-10-30T02:00:00.000Z')).toBe('29/10/2026, 23:00');
    expect(formatDateTime('2026-10-29T22:00:00.000Z', 'America/Manaus')).toBe('29/10/2026, 18:00');
    expect(formatInstantDate('2027-01-01T02:00:00.000Z')).toBe('31/12/2026');
  });

  it('formata a competência da mensalidade', () => {
    expect(formatMonthYear('2026-11-01')).toBe('nov 2026');
    expect(formatMonthYear('2027-01-01')).toBe('jan 2027');
  });

  it('formata duração', () => {
    expect(formatDuration(30)).toBe('30 min');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(90)).toBe('1h30');
    expect(formatDuration(150)).toBe('2h30');
  });

  it('"hoje" respeita o fuso (02:00 UTC ainda é o dia anterior em SP)', () => {
    expect(todayIn('America/Sao_Paulo', new Date('2026-11-03T02:00:00Z'))).toBe('2026-11-02');
  });

  it('lista hoje + janela de dias', () => {
    const dates = bookingDates(3, 'America/Sao_Paulo', new Date('2026-11-03T02:00:00Z'));
    expect(dates).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
  });

  it('formata distância', () => {
    expect(formatDistance(4)).toBe('10 m');
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(1234)).toBe('1,2 km');
    expect(formatDistance(15400)).toBe('15 km');
  });

  it('gera horários de 30 em 30 min até o fechamento', () => {
    expect(halfHourSlots('08:00', '10:00')).toEqual(['08:00', '08:30', '09:00', '09:30']);
  });

  it('calcula a janela de funcionamento com a virada do dia', () => {
    expect(openingWindowMinutes('08:00', '22:00')).toBe(840);
    expect(openingWindowMinutes('08:00', '00:00')).toBe(960);
    expect(openingWindowMinutes('18:00', '02:00')).toBe(480);
    expect(openingWindowMinutes('00:00', '00:00')).toBe(1440);
  });

  it('gera horários que passam da meia-noite normalizados em 24h', () => {
    expect(halfHourSlots('22:00', '01:00')).toEqual([
      '22:00',
      '22:30',
      '23:00',
      '23:30',
      '00:00',
      '00:30',
    ]);
    expect(halfHourSlots('00:00', '00:00')).toHaveLength(48);
  });
});
