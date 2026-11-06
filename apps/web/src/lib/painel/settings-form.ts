import type {
  PaymentMethod,
  SpaceSettings,
  UpdateSpaceSettingsInput,
} from '@space-sports/api-client';
import { centsToInput, parseMoneyToCents } from '@space-sports/shared';

/** Campos do formulário de configurações como texto (inputs controlados). */
export type SettingsDraft = {
  pricePerHour: string;
  minDuration: string;
  maxDuration: string;
  minAdvance: string;
  windowDays: string;
  cancellationDeadline: string;
  attendanceMode: 'AUTOMATIC' | 'MANUAL';
  attendanceOpenBefore: string;
  attendanceCloseBefore: string;
  attendanceCancelDeadline: string;
  pastDueBlockEnabled: boolean;
  pastDueBlockDays: string;
  methods: PaymentMethod[];
};

export function draftFromSettings(s: SpaceSettings): SettingsDraft {
  return {
    pricePerHour: centsToInput(s.pricePerHourCents),
    minDuration: String(s.bookingMinDurationMin),
    maxDuration: String(s.bookingMaxDurationMin),
    minAdvance: String(s.bookingMinAdvanceMin),
    windowDays: String(s.bookingWindowDays),
    cancellationDeadline: String(s.cancellationDeadlineMin),
    attendanceMode: s.attendanceMode,
    attendanceOpenBefore: String(s.attendanceOpenBeforeMin),
    attendanceCloseBefore: String(s.attendanceCloseBeforeMin),
    attendanceCancelDeadline: String(s.attendanceCancelDeadlineMin),
    pastDueBlockEnabled: s.pastDueBlockEnabled,
    pastDueBlockDays: String(s.pastDueBlockDays),
    methods: s.acceptedPaymentMethods,
  };
}

/** Maior prazo aceito pela API (30 dias). */
const MAX_DEADLINE_MIN = 43200;

const int = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);

export type SettingsResult =
  | { ok: true; data: UpdateSpaceSettingsInput }
  | { ok: false; errors: Record<string, string> };

/** Valida o formulário (espelha as regras da API: múltiplos de 30, mínimo ≤ máximo, etc.). */
export function settingsFromDraft(d: SettingsDraft): SettingsResult {
  const errors: Record<string, string> = {};
  // O preço por hora é obrigatório (sem ele o espaço some da vitrine): campo vazio não é omitido em silêncio.
  const price = parseMoneyToCents(d.pricePerHour);
  if (!d.pricePerHour.trim()) errors.pricePerHour = 'Informe o preço por hora';
  else if (price === null) errors.pricePerHour = 'Valor inválido';
  const min = int(d.minDuration);
  const max = int(d.maxDuration);
  for (const [key, value] of [
    ['minDuration', min],
    ['maxDuration', max],
  ] as const) {
    if (value === null || value < 30 || value > 1440 || value % 30 !== 0) {
      errors[key] = 'Use múltiplos de 30 minutos (30 a 1440)';
    }
  }
  if (min !== null && max !== null && min > max && !errors.minDuration) {
    errors.minDuration = 'A duração mínima não pode passar da máxima';
  }

  const minutes = (key: keyof SettingsDraft) => {
    const v = int(d[key] as string);
    if (v === null || v > MAX_DEADLINE_MIN) errors[key] = 'Use de 0 minutos a 30 dias';
    return v;
  };
  const advance = minutes('minAdvance');
  const cancel = minutes('cancellationDeadline');
  const attCancel = minutes('attendanceCancelDeadline');
  // No modo manual a tela esconde os dois tempos: não valida nem envia, e a API mantém os guardados.
  const automatic = d.attendanceMode === 'AUTOMATIC';
  const attOpen = automatic ? minutes('attendanceOpenBefore') : null;
  const attClose = automatic ? minutes('attendanceCloseBefore') : null;
  if (
    attOpen !== null &&
    attClose !== null &&
    attClose > attOpen &&
    !errors.attendanceCloseBefore
  ) {
    errors.attendanceCloseBefore = 'A lista precisa abrir antes de fechar: use um tempo menor';
  }

  // Com a regra desligada o campo de dias fica oculto na tela: só valida (e envia o valor) se ligada.
  const blockDays = int(d.pastDueBlockDays);
  if (d.pastDueBlockEnabled && (blockDays === null || blockDays < 1 || blockDays > 365))
    errors.pastDueBlockDays = 'De 1 a 365 dias';

  const windowDays = int(d.windowDays);
  if (windowDays === null || windowDays < 1 || windowDays > 365)
    errors.windowDays = 'De 1 a 365 dias';
  if (d.methods.length === 0) errors.methods = 'Aceite ao menos uma forma de pagamento';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      pricePerHourCents: price as number,
      bookingMinDurationMin: min as number,
      bookingMaxDurationMin: max as number,
      bookingMinAdvanceMin: advance as number,
      bookingWindowDays: windowDays as number,
      cancellationDeadlineMin: cancel as number,
      attendanceMode: d.attendanceMode,
      ...(automatic
        ? {
            attendanceOpenBeforeMin: attOpen as number,
            attendanceCloseBeforeMin: attClose as number,
          }
        : {}),
      attendanceCancelDeadlineMin: attCancel as number,
      pastDueBlockEnabled: d.pastDueBlockEnabled,
      // Desligada, o valor guardado não muda (a API mantém os dias para quando religar).
      ...(d.pastDueBlockEnabled ? { pastDueBlockDays: blockDays as number } : {}),
      acceptedPaymentMethods: d.methods,
    },
  };
}
