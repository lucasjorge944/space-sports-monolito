import { Inject, Injectable } from '@nestjs/common';
import {
  AD_REPORT_MAX_DAYS,
  type AdReport,
  type AdReportQuery,
  adCtr,
  addDays,
  DEFAULT_TIME_ZONE,
  utcToZoned,
} from '@space-sports/shared';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { CSV_BOM, csvLine } from '../common/csv.js';
import type { Database } from '../db/client.js';
import { adCampaigns, adCreatives, adDailyStats } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { campaignNotFound, reportRangeTooLarge } from './ads.errors.js';
import { adsAudit } from './ads-common.js';

const localDate = (instant: Date) => utcToZoned(instant, DEFAULT_TIME_ZONE).date;

/** Dias entre duas datas `aaaa-mm-dd` (inclusive). */
function daysBetween(from: string, to: string): number {
  return (
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  );
}

/** `aaaa-mm-dd` → `dd/mm/aaaa`. */
const brDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** CTR em porcentagem com vírgula (planilha em pt-BR). */
const ctrPercent = (ctr: number) => (ctr * 100).toFixed(2).replace('.', ',');

export const REPORT_CSV_COLUMNS = ['dia', 'impressoes', 'cliques', 'ctr_percentual'] as const;

/** Relatório da campanha (RF-ADS-09): impressões, cliques e CTR no total, por dia e por peça. */
@Injectable()
export class AdReportService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Período em dias de `America/Sao_Paulo` (o dia dos contadores). Padrão: do início da campanha
   * até hoje, ou até o último dia dela se já terminou. Até um ano por consulta.
   */
  async report(campaignId: string, query: AdReportQuery, now = new Date()): Promise<AdReport> {
    const [campaign] = await this.db
      .select({ startsAt: adCampaigns.startsAt, endsAt: adCampaigns.endsAt })
      .from(adCampaigns)
      .where(eq(adCampaigns.id, campaignId));
    if (!campaign) throw campaignNotFound();

    const today = localDate(now);
    const lastDay = localDate(new Date(campaign.endsAt.getTime() - 1));
    const from = query.from ?? localDate(campaign.startsAt);
    // Datas `aaaa-mm-dd`: a ordem do texto é a das datas.
    let to = query.to ?? ([lastDay, today].sort()[0] as string);
    if (to < from) to = from;
    if (daysBetween(from, to) > AD_REPORT_MAX_DAYS) throw reportRangeTooLarge();

    const inRange = and(
      eq(adDailyStats.campaignId, campaignId),
      gte(adDailyStats.day, from),
      lte(adDailyStats.day, to),
    );
    const [byDay, byCreative] = await Promise.all([
      this.db
        .select({
          day: adDailyStats.day,
          impressions: sql<number>`sum(${adDailyStats.impressions})::int`,
          clicks: sql<number>`sum(${adDailyStats.clicks})::int`,
        })
        .from(adDailyStats)
        .where(inRange)
        .groupBy(adDailyStats.day)
        .orderBy(asc(adDailyStats.day)),
      this.db
        .select({
          creativeId: adCreatives.id,
          title: adCreatives.title,
          impressions: sql<number>`coalesce(sum(${adDailyStats.impressions}), 0)::int`,
          clicks: sql<number>`coalesce(sum(${adDailyStats.clicks}), 0)::int`,
        })
        .from(adCreatives)
        .leftJoin(
          adDailyStats,
          and(
            eq(adDailyStats.creativeId, adCreatives.id),
            gte(adDailyStats.day, from),
            lte(adDailyStats.day, to),
          ),
        )
        .where(eq(adCreatives.campaignId, campaignId))
        .groupBy(adCreatives.id, adCreatives.title, adCreatives.position)
        .orderBy(asc(adCreatives.position), asc(adCreatives.id)),
    ]);

    const stats = new Map(byDay.map((row) => [row.day, row]));
    const days: AdReport['days'] = [];
    for (let day = from; day <= to; day = addDays(day, 1)) {
      const row = stats.get(day);
      const impressions = row?.impressions ?? 0;
      const clicks = row?.clicks ?? 0;
      days.push({ day, impressions, clicks, ctr: adCtr(impressions, clicks) });
    }
    const impressions = days.reduce((sum, day) => sum + day.impressions, 0);
    const clicks = days.reduce((sum, day) => sum + day.clicks, 0);
    return {
      campaignId,
      from,
      to,
      totals: { impressions, clicks, ctr: adCtr(impressions, clicks) },
      days,
      creatives: byCreative.map((row) => ({
        ...row,
        ctr: adCtr(row.impressions, row.clicks),
      })),
    };
  }

  /** CSV do relatório: um dia por linha e a linha `total` no fim (UTF-8 com BOM, vírgula). */
  async csv(campaignId: string, query: AdReportQuery): Promise<{ filename: string; body: string }> {
    const report = await this.report(campaignId, query);
    const lines = [
      `${CSV_BOM}${REPORT_CSV_COLUMNS.join(',')}\r\n`,
      ...report.days.map((day) =>
        csvLine([brDate(day.day), day.impressions, day.clicks, ctrPercent(day.ctr)]),
      ),
      csvLine([
        'total',
        report.totals.impressions,
        report.totals.clicks,
        ctrPercent(report.totals.ctr),
      ]),
    ];
    return { filename: `anuncio-${report.from}_${report.to}.csv`, body: lines.join('') };
  }

  /** Exportação na auditoria (`super.ad_campaign.export_csv`, com o período). */
  async auditExport(actorId: string, campaignId: string, query: AdReportQuery): Promise<void> {
    await adsAudit(this.db, actorId, {
      action: 'super.ad_campaign.export_csv',
      entity: 'ad_campaign',
      entityId: campaignId,
      diff: { from: query.from ?? null, to: query.to ?? null },
    });
  }
}
