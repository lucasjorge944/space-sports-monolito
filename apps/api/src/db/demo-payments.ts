import { randomBytes } from 'node:crypto';
import { addDays, fakeCardToken, utcToZoned, zonedToUtc } from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import { InProcessDomainEvents } from '../events/domain-events.js';
import { DataCipher } from '../payments/data-cipher.js';
import { FakePaymentGateway } from '../payments/gateways/fake/fake-gateway.js';
import { MerchantAccountsService } from '../payments/merchant-accounts.service.js';
import { OnlineChargesService } from '../payments/online-charges.service.js';
import { PAYMENT_JOBS } from '../payments/payment-jobs.names.js';
import { PaymentSettingsService } from '../payments/payment-settings.service.js';
import { MemoryPaymentsQueue } from '../payments/payments-queue.js';
import { WalletService } from '../payments/wallet.service.js';
import { WebhooksService } from '../payments/webhooks.service.js';
import type { Database } from './client.js';
import {
  bookings,
  courtOccupations,
  merchantAccounts,
  onlineCharges,
  spaceSettings,
} from './schema/index.js';

// Cenário de pagamento online para o seed de demonstração e o do E2E (só com o gateway fake): o
// cadastro do espaço aprovado, os modos ativos e algumas cobranças pagas e estornadas, para a
// carteira não começar vazia. Passa pelos serviços de verdade (cadastro, cobrança, webhook,
// estorno, repasse) com a fila em memória; nada é gravado à mão nas tabelas do pagamento.

export interface PaymentScenarioInput {
  spaceId: string;
  ownerId: string;
  playerId: string;
  courtId: string;
  sportId: string;
  timeZone: string;
  /** Documento de teste (válido, sem terminar em 0000: o fake aprova). */
  merchant: {
    documentType: 'CPF' | 'CNPJ';
    document: string;
    legalName: string;
    responsibleName: string;
    email: string;
    phone: string;
  };
  /** Hora local (minuto do dia) das reservas de demonstração, nos 3 próximos dias. */
  minuteOfDay?: number;
  /** PAYMENTS_DATA_KEY (decisão 97); padrão: a variável de ambiente. */
  dataKey?: string | undefined;
}

export type PaymentScenarioReport = 'created' | 'kept' | 'skipped';

/**
 * Serviços do pagamento online sobre o fake, com a fila em memória drenada aqui mesmo. A chave
 * cifra o documento do cadastro (decisão 97): a mesma PAYMENTS_DATA_KEY da API, para o relatório
 * fiscal decifrar; sem ela, uma chave avulsa (o documento de teste fica indecifrável).
 */
function services(db: Database, dataKey: string | undefined) {
  const queue = new MemoryPaymentsQueue();
  const gateway = new FakePaymentGateway(db, queue, {
    webhookSecret: randomBytes(32).toString('base64'),
    webhookUrl: 'http://127.0.0.1/v1/webhooks/payments/fake',
    approvalDelayMs: 0,
    chargebackDelayMs: 0,
    pixReleaseDays: 1,
    cardReleaseDays: 30,
    pixCostBps: 99,
    cardCostBps: 349,
    cardCostFixedCents: 39,
  });
  const events = new InProcessDomainEvents();
  const settings = new PaymentSettingsService(db, gateway);
  const charges = new OnlineChargesService(db, gateway, settings, events);
  const merchants = new MerchantAccountsService(
    db,
    gateway,
    events,
    new DataCipher(dataKey ?? randomBytes(32).toString('base64')),
  );
  const wallet = new WalletService(db, gateway, events);
  const webhooks = new WebhooksService(db, gateway, queue, charges, merchants, wallet);
  const jobs = gateway.jobs((delivery) =>
    webhooks
      .receive(delivery.provider, {
        headers: delivery.headers,
        rawBody: Buffer.from(delivery.body),
      })
      .then(() => undefined),
  );
  queue.setHandler(async (job) => {
    if (job.name === PAYMENT_JOBS.processEvent) return webhooks.process(String(job.data.id));
    const handler = jobs.handlers[job.name];
    if (!handler) throw new Error(`Job desconhecido no seed: ${job.name}`);
    return handler(job.data);
  });
  return { queue, gateway, settings, charges, merchants };
}

/**
 * Idempotente: espaço que já tem cadastro no gateway fica como está (`kept`). Sem preço/hora não há
 * o que cobrar (`skipped`).
 */
export async function seedPaymentScenario(
  db: Database,
  input: PaymentScenarioInput,
): Promise<PaymentScenarioReport> {
  const [existing] = await db
    .select({ id: merchantAccounts.id })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.spaceId, input.spaceId));
  if (existing) return 'kept';
  const [settingsRow] = await db
    .select({ price: spaceSettings.pricePerHourCents })
    .from(spaceSettings)
    .where(eq(spaceSettings.spaceId, input.spaceId));
  if (!settingsRow?.price) return 'skipped';

  const { queue, gateway, settings, charges, merchants } = services(
    db,
    input.dataKey ?? process.env.PAYMENTS_DATA_KEY,
  );
  await merchants.submit(input.spaceId, input.ownerId, {
    ...input.merchant,
    address: {
      postalCode: '30110000',
      street: 'Rua de Teste',
      number: '0',
      neighborhood: 'Centro',
      city: 'Belo Horizonte',
      state: 'MG',
    },
    payout: { kind: 'PIX_KEY', keyType: 'EMAIL', key: input.merchant.email },
    acceptTerms: true,
  });
  await queue.drain();
  await settings.updateModes(input.spaceId, input.ownerId, {
    bookingMode: 'ONLINE_OPTIONAL',
    classMode: 'ONLINE_OPTIONAL',
  });

  // Três reservas nos próximos dias, confirmadas pelo app, pagas online.
  const today = utcToZoned(new Date(), input.timeZone).date;
  const minute = input.minuteOfDay ?? 10 * 60;
  const ids: string[] = [];
  for (const day of [2, 3, 4]) {
    const startsAt = zonedToUtc(addDays(today, day), minute, input.timeZone);
    const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
    const id = await db.transaction(async (tx) => {
      const [booking] = await tx
        .insert(bookings)
        .values({
          spaceId: input.spaceId,
          courtId: input.courtId,
          organizerUserId: input.playerId,
          sportId: input.sportId,
          startsAt,
          endsAt,
          durationMin: 60,
          peopleCount: 2,
          pricePerHourCents: settingsRow.price as number,
          priceCents: settingsRow.price as number,
          status: 'CONFIRMED',
          source: 'APP',
        })
        .returning({ id: bookings.id });
      if (!booking) throw new Error('Reserva de demonstração não criada.');
      await tx.insert(courtOccupations).values({
        courtId: input.courtId,
        period: { start: startsAt, end: endsAt },
        kind: 'BOOKING',
        refId: booking.id,
      });
      return booking.id;
    });
    ids.push(id);
  }
  const [pixBooking, cardBooking, refundedBooking] = ids as [string, string, string];

  const pay = async (bookingId: string) => {
    const charge = await charges.payBooking(input.playerId, bookingId, { method: 'PIX' });
    const [row] = await db
      .select({ providerChargeId: onlineCharges.providerChargeId })
      .from(onlineCharges)
      .where(eq(onlineCharges.id, charge.id));
    if (row?.providerChargeId) await gateway.simulatePixPaid(row.providerChargeId);
    await queue.drain();
    return charge.id;
  };
  await pay(pixBooking);
  const refundedCharge = await pay(refundedBooking);
  const [charge] = await db
    .select({ amount: onlineCharges.amountCents })
    .from(onlineCharges)
    .where(eq(onlineCharges.id, refundedCharge));
  await charges.refund(refundedCharge, {
    spaceId: input.spaceId,
    amountCents: Math.max(Math.floor((charge?.amount ?? 0) / 4), 1),
    reason: 'Demonstração: desconto por chuva no fim do jogo.',
    reasonCode: 'MANUAL',
    requestedBy: input.ownerId,
    chargeAgain: false,
  });
  await queue.drain();

  // Libera os Pix e roda o repasse; o cartão, pago depois, fica a liberar (D+30).
  const [account] = await db
    .select({ providerAccountId: merchantAccounts.providerAccountId })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.spaceId, input.spaceId));
  if (account?.providerAccountId) {
    await gateway.settle(account.providerAccountId);
    await queue.drain();
  }
  await charges.payBooking(input.playerId, cardBooking, {
    method: 'CARD',
    cardToken: fakeCardToken('4111 1111 1111 1111') ?? '',
  });
  await queue.drain();
  return 'created';
}
