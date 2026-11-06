import { ApiError, type AvailabilityResponseDto } from '@space-sports/api-client';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { EditBookingSheet } from './edit-booking-sheet';
import { availability, booking, space } from './test-fixtures';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const mockInvalidate = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));

type Options = { mutation: { onSuccess: (d: unknown) => void; onError: (e: unknown) => void } };
const mockUpdate = jest.fn();
const mockAvailabilityParams = jest.fn();
let updateOptions: Options;
let mockGrid: AvailabilityResponseDto | undefined;
let mockGridBy: ((params: { date: string; durationMin: number }) => string[]) | null;

jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useGetSpaceAvailability: (_id: string, params: { date: string; durationMin: number }) => {
    mockAvailabilityParams(params);
    const fixtures = require('./test-fixtures') as typeof import('./test-fixtures');
    return {
      data: mockGridBy ? fixtures.availability(mockGridBy(params), params.durationMin) : mockGrid,
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    };
  },
  useUpdateMyBooking: (options: Options) => {
    updateOptions = options;
    return { mutate: (...args: unknown[]) => mockUpdate(...args), isPending: false };
  },
}));

const TEN = '2026-11-02T13:00:00.000Z'; // 10:00 em São Paulo
const ELEVEN = '2026-11-02T14:00:00.000Z';

const onSaved = jest.fn();
const onFailed = jest.fn();
const open = (item = booking(), loaded = space()) =>
  render(
    <EditBookingSheet
      visible
      booking={item}
      space={{ data: loaded, error: null, isError: false, refetch: jest.fn() }}
      onClose={jest.fn()}
      onSaved={onSaved}
      onFailed={onFailed}
    />,
  );

describe('Editar reserva (RF-BOOK-03, decisão 49)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-30T12:00:00.000Z'), doNotFake: ['nextTick'] });
    for (const fn of [mockUpdate, mockAvailabilityParams, mockInvalidate, onSaved, onFailed]) {
      fn.mockClear();
    }
    mockGrid = availability([TEN, ELEVEN]);
    mockGridBy = null;
  });
  afterEach(() => jest.useRealTimers());

  it('parte da reserva atual, com a grade que ignora ela mesma, e nada a confirmar', async () => {
    await open();
    expect(mockAvailabilityParams).toHaveBeenCalledWith({
      date: '2026-11-02',
      durationMin: 60,
      sportId: 'sp1',
      courtId: 'c1',
      excludeBookingId: 'b1',
    });
    expect(screen.getByTestId('editar-pessoas-valor')).toHaveTextContent('2');
    expect(screen.getByTestId('editar-horario-10:00')).toBeChecked();
    expect(screen.getByTestId('editar-total')).toHaveTextContent(/100,00/);
    expect(screen.getByTestId('editar-diferenca')).toHaveTextContent('Sem mudança');
    expect(screen.getByTestId('editar-confirmar').props.accessibilityState.disabled).toBe(true);
  });

  it('mudar as pessoas mostra a nova parte e envia só o número', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('editar-pessoas-mais'));
    await fireEvent.press(screen.getByTestId('editar-pessoas-mais'));
    expect(screen.getByTestId('editar-parte')).toHaveTextContent(/25,00/);
    expect(screen.getByTestId('editar-diferenca')).toHaveTextContent('Sem mudança');
    await fireEvent.press(screen.getByTestId('editar-confirmar'));
    expect(mockUpdate).toHaveBeenCalledWith({ bookingId: 'b1', data: { peopleCount: 4 } });
  });

  it('o número de pessoas respeita a quadra e os convidados que não recusaram', async () => {
    const guest = { id: 'p1', isOrganizer: false, isMe: false, status: 'INVITED' };
    await open(
      booking({
        peopleCount: 4,
        participants: [guest, { ...guest, id: 'p2' }, { ...guest, id: 'p3' }] as never,
      }),
    );
    expect(screen.getByText('O mínimo é 4: você e os convidados que não recusaram.')).toBeTruthy();
    expect(screen.getByTestId('editar-pessoas-menos').props.accessibilityState?.disabled).toBe(
      true,
    );
    expect(screen.getByTestId('editar-pessoas-mais').props.accessibilityState?.disabled).toBe(true);
  });

  it('mudar a duração mantém o horário livre e mostra a diferença de preço', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('editar-duracao-90'));
    expect(screen.getByTestId('editar-horario-10:00')).toBeTruthy();
    expect(screen.getByTestId('editar-diferenca')).toHaveTextContent(/\+R\$\s50,00/);
    expect(screen.getByTestId('editar-total')).toHaveTextContent(/150,00/);
    await fireEvent.press(screen.getByTestId('editar-confirmar'));
    expect(mockUpdate).toHaveBeenCalledWith({ bookingId: 'b1', data: { durationMin: 90 } });
  });

  it('encurtar reduz o preço com o sinal de menos', async () => {
    await open(
      booking({ durationMin: 120, priceCents: 20_000, endsAt: '2026-11-02T15:00:00.000Z' }),
    );
    await fireEvent.press(screen.getByTestId('editar-duracao-60'));
    expect(screen.getByTestId('editar-diferenca')).toHaveTextContent(/−R\$\s100,00/);
  });

  it('trocar a data pede novo horário antes de confirmar', async () => {
    mockGridBy = ({ date }) => (date === '2026-11-03' ? ['2026-11-03T18:00:00.000Z'] : [TEN]);
    await open();
    await fireEvent.press(screen.getByTestId('editar-data-2026-11-03'));
    expect(screen.getByText('Escolha um horário.')).toBeTruthy();
    expect(screen.getByTestId('editar-confirmar').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('editar-horario-15:00'));
    await fireEvent.press(screen.getByTestId('editar-confirmar'));
    expect(mockUpdate).toHaveBeenCalledWith({
      bookingId: 'b1',
      data: { startsAt: '2026-11-03T18:00:00.000Z' },
    });
  });

  it('sem horário livre explica e não deixa confirmar', async () => {
    mockGridBy = ({ durationMin }) => (durationMin === 60 ? [TEN] : []);
    await open();
    await fireEvent.press(screen.getByTestId('editar-duracao-120'));
    expect(screen.getByTestId('editar-sem-horarios')).toBeTruthy();
    expect(screen.getByTestId('editar-confirmar').props.accessibilityState.disabled).toBe(true);
  });

  it('conflito concorrente tira o horário, recarrega a grade e avisa', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('editar-horario-11:00'));
    await fireEvent.press(screen.getByTestId('editar-confirmar'));
    await act(async () =>
      updateOptions.mutation.onError(
        new ApiError({ status: 409, code: 'SLOT_UNAVAILABLE', message: 'x' }),
      ),
    );
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['/v1/spaces/s1/availability'] });
    expect(onFailed).toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/acabou de ser ocupado/);
    expect(screen.getByTestId('editar-horario-11:00')).not.toBeChecked();
    expect(screen.getByTestId('editar-confirmar').props.accessibilityState.disabled).toBe(true);
  });

  it('outras recusas mostram a mensagem com o mínimo vindo da API', async () => {
    await open();
    await act(async () =>
      updateOptions.mutation.onError(
        new ApiError({
          status: 422,
          code: 'PEOPLE_BELOW_PARTICIPANTS',
          message: 'x',
          details: { minPeople: 3 },
        }),
      ),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/pelo menos 3 pessoas/);
  });

  it('salvar atualiza a grade e devolve a reserva', async () => {
    await open();
    const updated = booking({ peopleCount: 3 });
    await act(async () => updateOptions.mutation.onSuccess(updated));
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['/v1/spaces/s1/availability'] });
    expect(onSaved).toHaveBeenCalledWith(updated);
  });

  it('com pagamento registrado só muda as pessoas, e o motivo leva ao WhatsApp', async () => {
    await open(
      booking({
        canEditSchedule: false,
        scheduleEditBlock: {
          code: 'BOOKING_HAS_PAYMENT',
          message: 'Esta reserva já tem pagamento registrado. Fale com o espaço.',
        },
      }),
      space({ whatsapp: '+5531999998888' }),
    );
    expect(screen.queryByTestId('editar-horario-10:00')).toBeNull();
    expect(mockAvailabilityParams).not.toHaveBeenCalled();
    expect(screen.getByTestId('editar-bloqueio-horario')).toHaveTextContent(/já tem pagamento/);
    expect(screen.getByTestId('reserva-whatsapp')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('editar-pessoas-mais'));
    await fireEvent.press(screen.getByTestId('editar-confirmar'));
    expect(mockUpdate).toHaveBeenCalledWith({ bookingId: 'b1', data: { peopleCount: 3 } });
  });

  it('sem WhatsApp cadastrado, fica só o motivo', async () => {
    await open(
      booking({
        canEditSchedule: false,
        scheduleEditBlock: { code: 'BOOKING_HAS_PAYMENT', message: 'Fale com o espaço.' },
      }),
    );
    expect(screen.queryByTestId('reserva-whatsapp')).toBeNull();
  });

  it('o espaço que falhou ao carregar oferece tentar de novo', async () => {
    await render(
      <EditBookingSheet
        visible
        booking={booking()}
        space={{
          error: new TypeError('Network request failed'),
          isError: true,
          refetch: jest.fn(),
        }}
        onClose={jest.fn()}
        onSaved={onSaved}
        onFailed={onFailed}
      />,
    );
    expect(screen.getByText('Tentar novamente')).toBeTruthy();
  });
});
