import { sql } from 'drizzle-orm';
import { audit, type DbOrTx, type Tx } from '../bookings/db-utils.js';
import { adCampaigns, advertisers } from '../db/schema/index.js';
import { advertiserNotFound, campaignNotFound } from './ads.errors.js';

/**
 * Auditoria dos anúncios (RN-ADS-06): `super.advertiser.*`, `super.ad_campaign.*` e
 * `super.ad_creative.*`. `actorId` nulo = seed de demonstração (sem usuário).
 */
export function adsAudit(
  db: DbOrTx,
  actorId: string | null,
  entry: {
    action: string;
    entity: 'advertiser' | 'ad_campaign' | 'ad_creative';
    entityId: string | null;
    diff?: Record<string, unknown>;
  },
): Promise<void> {
  return audit(db, {
    actorId,
    actingAsSuper: actorId !== null,
    spaceId: null,
    ...entry,
  });
}

/** Trava a campanha (peças, posições e status sem corrida). */
export async function lockCampaign(tx: Tx, campaignId: string): Promise<void> {
  const { rows } = await tx.execute<{ id: string }>(
    sql`SELECT ${adCampaigns.id} FROM ${adCampaigns} WHERE ${adCampaigns.id} = ${campaignId} FOR UPDATE`,
  );
  if (!rows.length) throw campaignNotFound();
}

/** Trava o anunciante (ativação do anunciante de espaço, sem corrida com outro do mesmo espaço). */
export async function lockAdvertiser(tx: Tx, advertiserId: string): Promise<void> {
  const { rows } = await tx.execute<{ id: string }>(
    sql`SELECT ${advertisers.id} FROM ${advertisers} WHERE ${advertisers.id} = ${advertiserId} FOR UPDATE`,
  );
  if (!rows.length) throw advertiserNotFound();
}

/** Só os campos que mudaram, para o `diff` da auditoria. */
export function changes<T extends Record<string, unknown>>(
  before: T,
  input: Partial<T>,
): { before: Partial<T>; after: Partial<T> } | null {
  const out = { before: {} as Partial<T>, after: {} as Partial<T> };
  for (const [key, value] of Object.entries(input) as [keyof T, T[keyof T]][]) {
    if (value === undefined) continue;
    if (JSON.stringify(before[key]) === JSON.stringify(value)) continue;
    out.before[key] = before[key];
    out.after[key] = value;
  }
  return Object.keys(out.after).length ? out : null;
}
