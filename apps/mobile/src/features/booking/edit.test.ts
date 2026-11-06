import {
  editBlockNotice,
  editChanges,
  editDates,
  editPreview,
  editTimeOptions,
  minPeople,
  shouldTalkToSpace,
} from './edit';
import { booking } from './test-fixtures';

const ZONE = 'America/Sao_Paulo';
const blocked = (code: string, message = 'Motivo') => ({ code, message }) as never;

describe('editBlockNotice', () => {
  it('com alguma edição permitida não há aviso', () => {
    expect(editBlockNotice(booking())).toBeNull();
    expect(
      editBlockNotice(
        booking({ canEditSchedule: false, scheduleEditBlock: blocked('BOOKING_HAS_PAYMENT') }),
      ),
    ).toBeNull();
  });

  it('sem permissão, mostra o motivo da API: o das pessoas, que dura mais', () => {
    expect(
      editBlockNotice(
        booking({
          canEditPeople: false,
          peopleEditBlock: blocked('BOOKING_STARTED', 'Já começou'),
          canEditSchedule: false,
          scheduleEditBlock: blocked('BOOKING_EDIT_DEADLINE_PASSED'),
        }),
      )?.message,
    ).toBe('Já começou');
  });

  it.each(['NOT_BOOKING_ORGANIZER', 'BOOKING_ENDED', 'INVALID_BOOKING_STATUS'])(
    '%s não vira aviso',
    (code) => {
      expect(
        editBlockNotice(
          booking({
            canEditPeople: false,
            peopleEditBlock: blocked(code),
            canEditSchedule: false,
            scheduleEditBlock: blocked(code),
          }),
        ),
      ).toBeNull();
    },
  );

  it('reserva que não está confirmada não explica nada', () => {
    expect(
      editBlockNotice(
        booking({
          status: 'CANCELLED',
          canEditPeople: false,
          peopleEditBlock: blocked('BOOKING_NOT_EDITABLE'),
          canEditSchedule: false,
          scheduleEditBlock: blocked('BOOKING_NOT_EDITABLE'),
        }),
      ),
    ).toBeNull();
  });
});

describe('shouldTalkToSpace', () => {
  it('espaço suspenso não adianta procurar; pagamento e prazo sim', () => {
    expect(shouldTalkToSpace('SPACE_READ_ONLY')).toBe(false);
    expect(shouldTalkToSpace('BOOKING_HAS_PAYMENT')).toBe(true);
    expect(shouldTalkToSpace('BOOKING_EDIT_DEADLINE_PASSED')).toBe(true);
  });
});

describe('editDates', () => {
  it('mantém a data da reserva fora da janela, em ordem', () => {
    expect(editDates(['2026-11-01', '2026-11-02'], '2026-11-02')).toEqual([
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(editDates(['2026-11-01', '2026-11-02'], '2026-11-09')).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-09',
    ]);
  });
});

describe('editTimeOptions', () => {
  const other = { startsAt: '2026-11-02T12:00:00.000Z', endsAt: 'x', courts: [] };

  it('o horário atual aparece mesmo fora da grade, na data e na duração atuais', () => {
    const options = editTimeOptions([other], booking(), '2026-11-02', 60, ZONE);
    expect(options.map((o) => o.startsAt)).toEqual([other.startsAt, booking().startsAt]);
  });

  it('com outra data ou duração, vale só a grade', () => {
    expect(editTimeOptions([other], booking(), '2026-11-03', 60, ZONE)).toEqual([other]);
    expect(editTimeOptions([other], booking(), '2026-11-02', 90, ZONE)).toEqual([other]);
  });

  it('não duplica o horário que já está na grade', () => {
    const current = { ...other, startsAt: booking().startsAt };
    expect(editTimeOptions([current], booking(), '2026-11-02', 60, ZONE)).toEqual([current]);
  });
});

describe('editChanges', () => {
  const b = booking();
  const same = { peopleCount: b.peopleCount, startsAt: b.startsAt, durationMin: b.durationMin };

  it('sem mudança, nada a enviar', () => {
    expect(editChanges(b, same)).toEqual({});
  });

  it('envia só o que mudou (o horário bloqueado nem vai no PATCH)', () => {
    expect(editChanges(b, { ...same, peopleCount: 4 })).toEqual({ peopleCount: 4 });
    expect(editChanges(b, { ...same, durationMin: 90 })).toEqual({ durationMin: 90 });
    expect(editChanges(b, { ...same, startsAt: '2026-11-02T15:00:00.000Z' })).toEqual({
      startsAt: '2026-11-02T15:00:00.000Z',
    });
  });
});

describe('editPreview (RN-BOOK-01, RN-BOOK-09, decisão 49)', () => {
  it('recalcula pelo valor/hora guardado e mostra a diferença', () => {
    const preview = editPreview(booking(), 2, 90);
    expect(preview.priceCents).toBe(15_000);
    expect(preview.differenceCents).toBe(5_000);
    expect(preview.shareCents).toBe(7_500);
  });

  it('diminuir fica negativo; a sobra do arredondamento é do organizador', () => {
    const preview = editPreview(booking({ priceCents: 20_000 }), 3, 60);
    expect(preview.differenceCents).toBe(-10_000);
    expect(preview.shareCents).toBe(3_333);
    expect(preview.organizerShareCents).toBe(3_334);
  });

  it('sozinho, a parte é o total', () => {
    expect(editPreview(booking(), 1, 60).shareCents).toBe(10_000);
  });
});

describe('minPeople', () => {
  it('organizador mais convidados que não recusaram (RN-BOOK-11)', () => {
    const guest = (status: string) => ({ isOrganizer: false, status }) as never;
    expect(minPeople([])).toBe(1);
    expect(minPeople([guest('INVITED'), guest('ACCEPTED'), guest('DECLINED')])).toBe(3);
  });
});
