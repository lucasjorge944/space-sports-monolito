import { cancellationMessage, canResumeCancellation } from './cancellation';
import { subscription } from './test-fixtures';

const TODAY = '2026-10-29';
const october = {
  ...subscription().charges[1],
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
} as ReturnType<typeof subscription>['charges'][number];

describe('cancellationMessage (RN-CLASS-08, decisão 45)', () => {
  it('com mês pago, diz até quando o plano fica ativo', () => {
    expect(
      cancellationMessage(subscription({ accessUntilIfCancelled: '2026-11-30' }), TODAY),
    ).toMatch(/^Seu plano fica ativo até 30\/11\/2026\./);
  });

  it('sem mês pago e sem mensalidade gerada, só avisa que o acesso termina agora', () => {
    expect(
      cancellationMessage(subscription({ accessUntilIfCancelled: null, charges: [] }), TODAY),
    ).toBe('O acesso termina agora.');
  });

  it('a mensalidade do mês sem pagamento é dispensada', () => {
    const charges = [{ ...october, status: 'PENDING' as const, paidCents: 0 }];
    expect(
      cancellationMessage(subscription({ accessUntilIfCancelled: null, charges }), TODAY),
    ).toBe('O acesso termina agora. A mensalidade deste mês é dispensada.');
  });

  it('pagamento parcial não é dispensado: fica em aberto', () => {
    const charges = [{ ...october, status: 'PENDING' as const, paidCents: 10_000 }];
    expect(
      cancellationMessage(subscription({ accessUntilIfCancelled: null, charges }), TODAY),
    ).toMatch(/pagamento parcial e fica em aberto/);
  });

  it('mensalidade vencida continua devida', () => {
    const charges = [{ ...october, status: 'OVERDUE' as const, paidCents: 0 }];
    const message = cancellationMessage(
      subscription({ accessUntilIfCancelled: null, charges, overdueCents: 29_900 }),
      TODAY,
    );
    expect(message).toMatch(/A mensalidade em atraso \(R\$\s299,00\) continua devida/);
    expect(message).not.toMatch(/dispensada/);
  });
});

describe('canResumeCancellation', () => {
  const pending = { status: 'ACTIVE', cancelAtPeriodEnd: true, accessUntil: TODAY } as const;

  it('vale até o último dia de acesso, inclusive', () => {
    expect(canResumeCancellation(pending, TODAY)).toBe(true);
    expect(canResumeCancellation(pending, '2026-10-30')).toBe(false);
  });

  it('não vale sem cancelamento pedido nem em plano encerrado', () => {
    expect(canResumeCancellation({ ...pending, cancelAtPeriodEnd: false }, TODAY)).toBe(false);
    expect(canResumeCancellation({ ...pending, status: 'CANCELLED' }, TODAY)).toBe(false);
  });
});
