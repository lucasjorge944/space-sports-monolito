import { createEventInCalendarAsync } from 'expo-calendar/legacy';
import { addBookingToCalendar, calendarTitle, canAddToCalendar } from './calendar';

jest.mock('expo-calendar/legacy', () => ({
  createEventInCalendarAsync: jest.fn(async () => ({ action: 'done', id: null })),
  // Se o código pedisse permissão, estes mocks apareceriam nas asserções abaixo.
  requestCalendarPermissionsAsync: jest.fn(),
  getCalendarPermissionsAsync: jest.fn(),
}));

const booking = {
  status: 'CONFIRMED' as const,
  startsAt: '2026-10-29T22:00:00.000Z',
  endsAt: '2026-10-29T23:00:00.000Z',
  sport: { id: 's', name: 'Futevôlei', slug: 'futevolei' },
  space: { id: 'e', name: 'Arena 7', slug: 'arena-7', timeZone: 'America/Sao_Paulo' },
  court: { id: 'c', name: 'Quadra 1' },
};

describe('adicionar ao calendário', () => {
  it('abre a tela do sistema com o evento, sem pedir permissão de calendário', async () => {
    const legacy = jest.requireMock('expo-calendar/legacy');
    await addBookingToCalendar(booking, 'Rua A, 1');
    expect(createEventInCalendarAsync).toHaveBeenCalledWith({
      title: 'Futevôlei · Arena 7',
      startDate: new Date(booking.startsAt),
      endDate: new Date(booking.endsAt),
      timeZone: 'America/Sao_Paulo',
      notes: 'Quadra: Quadra 1',
      location: 'Rua A, 1',
    });
    expect(legacy.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
    expect(legacy.getCalendarPermissionsAsync).not.toHaveBeenCalled();
  });

  it('omite o local quando o espaço não tem endereço', async () => {
    await addBookingToCalendar(booking, null);
    const event = (createEventInCalendarAsync as jest.Mock).mock.lastCall?.[0];
    expect(event).not.toHaveProperty('location');
  });

  it('o título junta esporte e espaço', () => {
    expect(calendarTitle(booking)).toBe('Futevôlei · Arena 7');
  });

  it('só reservas confirmadas que ainda não terminaram', () => {
    expect(canAddToCalendar(booking, new Date('2026-10-29T12:00:00Z'))).toBe(true);
    expect(canAddToCalendar(booking, new Date('2026-10-29T23:00:00Z'))).toBe(false);
    expect(
      canAddToCalendar({ ...booking, status: 'CANCELLED' }, new Date('2026-10-29T12:00:00Z')),
    ).toBe(false);
  });
});
