import { Inject, Injectable } from '@nestjs/common';
import {
  type BookingPaymentMode,
  type ClassPaymentMode,
  type FeeSettings,
  type MerchantAccountStatus,
  type PaymentEnvironment,
  type PaymentOption,
  paymentOptionsFor,
  resolveFeeSettings,
  type SpacePaymentSettings,
  type UpdatePaymentModesInput,
} from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import { audit, type DbOrTx } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import {
  merchantAccounts,
  platformFeeSettings,
  spacePaymentSettings,
  spaces,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { PAYMENT_GATEWAY, paymentEnvironmentOf } from './gateway/gateway.registry.js';
import type { PaymentGateway } from './gateway/payment-gateway.js';
import { merchantNotApproved } from './payments.errors.js';

/** Modos e taxa em vigor de um espaço, com o que a cobrança precisa do cadastro no gateway. */
export interface EffectivePaymentSettings {
  enabled: boolean;
  spaceActive: boolean;
  merchantAccountStatus: MerchantAccountStatus;
  /**
   * Pode cobrar online: gateway ligado, espaço ativo e subconta já aprovada (a troca de conta em
   * análise, decisão 95, só pausa os repasses).
   */
  onlineReady: boolean;
  /** Troca da conta de recebimento em análise: repasses pausados (decisão 95). */
  payoutsPaused: boolean;
  providerAccountId: string | null;
  bookingMode: BookingPaymentMode;
  classMode: ClassPaymentMode;
  effectiveBookingMode: BookingPaymentMode;
  effectiveClassMode: ClassPaymentMode;
  fee: FeeSettings & { custom: boolean };
}

/**
 * Modos de pagamento do espaço e taxa vigente (RF-ONPAY-02, RN-ONPAY-01, RN-ONPAY-09). O modo
 * gravado só vale com o gateway ligado, o cadastro `APPROVED` e o espaço `ACTIVE`; senão, na
 * leitura, tudo volta a `ON_SITE`.
 */
@Injectable()
export class PaymentSettingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
  ) {}

  get enabled(): boolean {
    return this.gateway !== null;
  }

  get environment() {
    return paymentEnvironmentOf(this.gateway);
  }

  /** Taxa padrão do Super (linha única criada na migração 0025). */
  async defaultFees(db: DbOrTx = this.db): Promise<FeeSettings & { updatedAt: Date }> {
    const [row] = await db.select().from(platformFeeSettings).where(eq(platformFeeSettings.id, 1));
    if (!row) throw new Error('platform_fee_settings sem a linha padrão.');
    return {
      pixFeeBps: row.pixFeeBps,
      cardFeeBps: row.cardFeeBps,
      minFeeCents: row.minFeeCents,
      feePayer: row.feePayer,
      updatedAt: row.updatedAt,
    };
  }

  async effective(spaceId: string, db: DbOrTx = this.db): Promise<EffectivePaymentSettings> {
    const [row] = await db
      .select({
        spaceStatus: spaces.status,
        settings: spacePaymentSettings,
        merchantStatus: merchantAccounts.status,
        approvedAt: merchantAccounts.approvedAt,
        providerAccountId: merchantAccounts.providerAccountId,
        merchantProvider: merchantAccounts.provider,
      })
      .from(spaces)
      .leftJoin(spacePaymentSettings, eq(spacePaymentSettings.spaceId, spaces.id))
      .leftJoin(merchantAccounts, eq(merchantAccounts.spaceId, spaces.id))
      .where(eq(spaces.id, spaceId));
    const defaults = await this.defaultFees(db);
    const settings = row?.settings;
    const custom = Boolean(
      settings &&
        (settings.pixFeeBps !== null ||
          settings.cardFeeBps !== null ||
          settings.minFeeCents !== null ||
          settings.feePayer !== null),
    );
    // Cadastro feito em outro provedor não vale com o gateway atual.
    const sameProvider = row?.merchantProvider === this.gateway?.provider;
    const merchantAccountStatus: MerchantAccountStatus =
      row?.merchantStatus && sameProvider ? row.merchantStatus : 'NOT_STARTED';
    const spaceActive = row?.spaceStatus === 'ACTIVE';
    const wasApproved = sameProvider && Boolean(row?.approvedAt);
    const online =
      this.enabled && spaceActive && wasApproved && merchantAccountStatus !== 'REJECTED';
    const bookingMode = settings?.bookingMode ?? 'ON_SITE';
    const classMode = settings?.classMode ?? 'ON_SITE';
    return {
      enabled: this.enabled,
      spaceActive,
      merchantAccountStatus,
      onlineReady: online,
      payoutsPaused: wasApproved && merchantAccountStatus === 'PENDING',
      providerAccountId: sameProvider ? (row?.providerAccountId ?? null) : null,
      bookingMode,
      classMode,
      effectiveBookingMode: online ? bookingMode : 'ON_SITE',
      effectiveClassMode: online ? classMode : 'ON_SITE',
      fee: { ...resolveFeeSettings(defaults, settings), custom },
    };
  }

  async get(spaceId: string): Promise<SpacePaymentSettings> {
    return this.toSettings(await this.effective(spaceId));
  }

  toSettings(s: EffectivePaymentSettings): SpacePaymentSettings {
    return {
      paymentEnvironment: this.environment,
      merchantAccountStatus: s.merchantAccountStatus,
      bookingMode: s.bookingMode,
      classMode: s.classMode,
      onlineReady: s.onlineReady,
      effectiveBookingMode: s.effectiveBookingMode,
      effectiveClassMode: s.effectiveClassMode,
      fee: s.fee,
    };
  }

  /** RF-ONPAY-02: modos online só com o gateway ligado e o cadastro aprovado. */
  async updateModes(
    spaceId: string,
    actorId: string,
    input: UpdatePaymentModesInput,
  ): Promise<SpacePaymentSettings> {
    await this.db.transaction(async (tx) => {
      const current = await this.effective(spaceId, tx);
      const wantsOnline = input.bookingMode !== 'ON_SITE' || input.classMode !== 'ON_SITE';
      if (wantsOnline && !current.onlineReady) throw merchantNotApproved();
      await tx
        .insert(spacePaymentSettings)
        .values({ spaceId, ...input, updatedBy: actorId })
        .onConflictDoUpdate({
          target: spacePaymentSettings.spaceId,
          set: { ...input, updatedBy: actorId },
        });
      await audit(tx, {
        actorId,
        spaceId,
        action: 'payment_settings.update',
        entity: 'space_payment_settings',
        entityId: null,
        diff: {
          from: { bookingMode: current.bookingMode, classMode: current.classMode },
          to: input,
        },
      });
    });
    return this.get(spaceId);
  }

  /** O que o espaço público informa para o app montar a etapa de pagamento (RF-ONPAY-03). */
  async publicOptions(spaceId: string): Promise<{
    onlinePayments: {
      rental: { mode: BookingPaymentMode; options: PaymentOption[] };
      classes: { mode: ClassPaymentMode; options: PaymentOption[] };
    };
    paymentEnvironment: PaymentEnvironment;
  }> {
    const settings = await this.effective(spaceId);
    return {
      onlinePayments: {
        rental: {
          mode: settings.effectiveBookingMode,
          options: paymentOptionsFor(settings.effectiveBookingMode),
        },
        classes: {
          mode: settings.effectiveClassMode,
          options: paymentOptionsFor(settings.effectiveClassMode),
        },
      },
      paymentEnvironment: this.environment,
    };
  }
}
