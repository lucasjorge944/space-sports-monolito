import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './columns.js';
import { payableType, paymentChannel, paymentMethod } from './enums.js';
import { users } from './identity.js';
import { onlineCharges } from './online-payments.js';
import { spaces } from './spaces.js';

/**
 * Registro de pagamentos (RF-PAY-01): os feitos no espaço, registrados pela gestão, e os pagos
 * online pelo app (`channel = ONLINE`, com `online_charge_id` e sem `recorded_by`, RN-ONPAY-04).
 * O item pago é polimórfico (`payable_type` + `payable_id`), sem FK. Estorno marca `reversed_at`
 * (`reversed_by` nulo quando o sistema estorna: chargeback, estorno automático).
 */
export const paymentRecords = pgTable(
  'payment_records',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id),
    payableType: payableType().notNull(),
    payableId: uuid().notNull(),
    payerUserId: uuid().references(() => users.id),
    amountCents: integer().notNull(),
    method: paymentMethod().notNull(),
    channel: paymentChannel().notNull().default('ON_SITE'),
    /** Cobrança online que gerou o registro. */
    onlineChargeId: uuid().references(() => onlineCharges.id),
    paidAt: tstz().notNull(),
    /** Nulo no pagamento online (o sistema registra). */
    recordedBy: uuid().references(() => users.id),
    reversedAt: tstz(),
    reversedBy: uuid().references(() => users.id),
    note: text(),
    ...timestamps,
  },
  (t) => [
    index('payment_records_payable_idx').on(t.payableType, t.payableId),
    index('payment_records_space_id_paid_at_idx').on(t.spaceId, t.paidAt),
    index('payment_records_payer_user_id_idx').on(t.payerUserId),
    index('payment_records_recorded_by_idx').on(t.recordedBy),
    index('payment_records_reversed_by_idx').on(t.reversedBy),
    index('payment_records_online_charge_id_idx').on(t.onlineChargeId),
    check('payment_records_amount_cents_positive', sql`${t.amountCents} > 0`),
    // Quem estornou só existe com o estorno; o sistema estorna sem `reversed_by`.
    check(
      'payment_records_reversal_consistent',
      sql`${t.reversedBy} IS NULL OR ${t.reversedAt} IS NOT NULL`,
    ),
    // No local, sempre alguém da gestão registrou; online, a cobrança e o sistema.
    check(
      'payment_records_channel_consistent',
      sql`CASE ${t.channel} WHEN 'ON_SITE' THEN ${t.recordedBy} IS NOT NULL AND ${t.onlineChargeId} IS NULL ELSE ${t.onlineChargeId} IS NOT NULL AND ${t.recordedBy} IS NULL END`,
    ),
  ],
);
