import { Inject, Injectable } from '@nestjs/common';
import {
  type AdEventsInput,
  type AdEventsResult,
  type AdEventType,
  DEFAULT_TIME_ZONE,
  utcToZoned,
} from '@space-sports/shared';
import { inArray, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { adCreatives, adDailyStats, adEventReceipts } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { type DeliveryClaims, DeliveryTokens } from './delivery-token.js';

/**
 * Impressões e cliques (RF-ADS-08, RN-ADS-03, RN-ADS-04). Cada evento traz o token da entrega;
 * token inválido, adulterado ou vencido é descartado em silêncio. O recibo `(delivery_id, tipo)`
 * faz cada token contar no máximo uma impressão e um clique, e a soma vai para o contador diário
 * da peça (dia de `America/Sao_Paulo` em que o evento chegou). Clique de entrega sem impressão
 * contada grava a impressão junto (quem clicou viu a peça; o lote da impressão pode ter se perdido
 * ou chegar depois), então os cliques nunca passam das impressões. Nada de usuário, aparelho ou IP.
 */
@Injectable()
export class AdEventsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly tokens: DeliveryTokens,
  ) {}

  async record({ events }: AdEventsInput, now: Date = new Date()): Promise<AdEventsResult> {
    // Tokens válidos, sem repetir (entrega, tipo) dentro do lote.
    const sent = new Map<string, { claims: DeliveryClaims; type: AdEventType }>();
    for (const event of events) {
      const claims = this.tokens.verify(event.token, now);
      if (claims) sent.set(receiptKey(claims.deliveryId, event.type), { claims, type: event.type });
    }
    if (!sent.size) return { accepted: 0 };
    // Token bem assinado de peça que não existe mais (banco recriado ou seed reaplicado dentro da
    // validade, mesmo segredo em outro ambiente) também é descartado em silêncio (RN-ADS-04), e a
    // peça tem de ser da campanha do token.
    const creativeIds = [...new Set([...sent.values()].map(({ claims }) => claims.creativeId))];
    const existing = await this.db
      .select({ id: adCreatives.id, campaignId: adCreatives.campaignId })
      .from(adCreatives)
      .where(inArray(adCreatives.id, creativeIds));
    const campaignOf = new Map(existing.map((row) => [row.id, row.campaignId]));
    for (const [key, { claims }] of sent) {
      if (campaignOf.get(claims.creativeId) !== claims.campaignId) sent.delete(key);
    }
    if (!sent.size) return { accepted: 0 };
    // O clique leva a impressão da mesma entrega (se ela já contou, o recibo dela barra a repetição).
    const receipts = new Map(sent);
    for (const { claims, type } of sent.values()) {
      const impression = receiptKey(claims.deliveryId, 'IMPRESSION');
      if (type === 'CLICK' && !receipts.has(impression)) {
        receipts.set(impression, { claims, type: 'IMPRESSION' });
      }
    }
    // Ordem fixa das linhas: lotes simultâneos travam na mesma ordem (sem deadlock).
    const items = [...receipts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, item]) => item);
    const day = utcToZoned(now, DEFAULT_TIME_ZONE).date;

    const accepted = await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(adEventReceipts)
        .values(
          items.map(({ claims, type }) => ({
            deliveryId: claims.deliveryId,
            kind: type,
            expiresAt: claims.expiresAt,
          })),
        )
        .onConflictDoNothing()
        .returning({ deliveryId: adEventReceipts.deliveryId, kind: adEventReceipts.kind });
      if (!inserted.length) return 0;

      const counted = new Set(inserted.map((row) => receiptKey(row.deliveryId, row.kind)));
      const totals = new Map<
        string,
        {
          creativeId: string;
          campaignId: string;
          placement: DeliveryClaims['placement'];
          impressions: number;
          clicks: number;
        }
      >();
      for (const { claims, type } of items) {
        if (!counted.has(receiptKey(claims.deliveryId, type))) continue;
        const total = totals.get(claims.creativeId) ?? {
          creativeId: claims.creativeId,
          campaignId: claims.campaignId,
          placement: claims.placement,
          impressions: 0,
          clicks: 0,
        };
        if (type === 'IMPRESSION') total.impressions += 1;
        else total.clicks += 1;
        totals.set(claims.creativeId, total);
      }
      const rows = [...totals.values()].sort((a, b) => a.creativeId.localeCompare(b.creativeId));
      await tx
        .insert(adDailyStats)
        .values(rows.map((row) => ({ ...row, day })))
        .onConflictDoUpdate({
          target: [adDailyStats.creativeId, adDailyStats.day],
          set: {
            impressions: sql`${adDailyStats.impressions} + excluded.impressions`,
            clicks: sql`${adDailyStats.clicks} + excluded.clicks`,
            updatedAt: sql`now()`,
          },
        });
      // `accepted`: só os eventos do lote (a impressão gravada com o clique não entra).
      return [...counted].filter((key) => sent.has(key)).length;
    });
    return { accepted };
  }

  /** Apaga os recibos de tokens vencidos (job diário): depois disso o token já não conta. */
  async purgeExpiredReceipts(now: Date = new Date()): Promise<number> {
    const result = await this.db.delete(adEventReceipts).where(lt(adEventReceipts.expiresAt, now));
    return result.rowCount ?? 0;
  }
}

const receiptKey = (deliveryId: string, type: AdEventType) => `${deliveryId}:${type}`;
