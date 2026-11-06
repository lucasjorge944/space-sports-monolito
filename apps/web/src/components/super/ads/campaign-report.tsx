'use client';

import {
  type AdCampaignDetail,
  superExportAdCampaignReportCsv,
  useSuperGetAdCampaignReport,
} from '@space-sports/api-client';
import { keepPreviousData } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { FormError } from '@/components/auth/form-alert';
import { Field } from '@/components/painel/field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateRangePicker } from '@/components/ui/date-picker';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDayLabel } from '@/lib/format';
import { adErrorMessage, formatCount, formatCtr, reportCsvFilename } from '@/lib/super/ads';
import { downloadTextFile } from '@/lib/super/csv';
import { EmptyBlock, LoadingBlock } from '../query-states';
import { StatCard } from '../stat-card';

type Range = { from: string; to: string };

/**
 * Relatório da campanha (RF-ADS-09): impressões, cliques e CTR no período (dias de
 * America/Sao_Paulo), por dia e por peça, com exportação em CSV para o anunciante. Sem o período
 * escolhido, a API usa do início da campanha até hoje (ou até o fim).
 */
export function CampaignReport({ campaign }: { campaign: Pick<AdCampaignDetail, 'id' | 'name'> }) {
  const [range, setRange] = useState<Range | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const validRange =
    range === null || (Boolean(range.from) && Boolean(range.to) && range.from <= range.to);
  const params = range ?? undefined;
  const report = useSuperGetAdCampaignReport(campaign.id, params, {
    query: { enabled: validRange, placeholderData: keepPreviousData },
  });
  const shown: Range | null =
    range ?? (report.data ? { from: report.data.from, to: report.data.to } : null);

  async function exportCsv() {
    if (!shown) return;
    setExportError(undefined);
    setExporting(true);
    try {
      // O CSV vem pronto da API (BOM, dd/mm/aaaa, linha `total`) e a exportação fica na auditoria.
      const csv = await superExportAdCampaignReportCsv(campaign.id, shown);
      downloadTextFile(
        reportCsvFilename(campaign.name, shown.from, shown.to),
        csv.replace(/^﻿/, ''),
      );
    } catch (error) {
      setExportError(adErrorMessage(error));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-md">
          <Field label="Período" group hint="Dias em horário de Brasília, até um ano por consulta.">
            <DateRangePicker
              from={shown?.from ?? ''}
              to={shown?.to ?? ''}
              onValueChange={(next) => setRange(next)}
            />
          </Field>
        </div>
        <Button
          variant="outline"
          onClick={() => void exportCsv()}
          disabled={!validRange || !shown || exporting}
        >
          {exporting ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
          {exporting ? 'Exportando…' : 'Exportar CSV'}
        </Button>
      </div>
      <FormError message={exportError} />

      {!validRange ? (
        <EmptyBlock>Escolha um período com o início antes do fim.</EmptyBlock>
      ) : report.isPending ? (
        <LoadingBlock rows={4} />
      ) : report.isError ? (
        <FormError message={adErrorMessage(report.error)} />
      ) : (
        <>
          <section aria-label="Totais" className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Impressões" value={formatCount(report.data.totals.impressions)} />
            <StatCard label="Cliques" value={formatCount(report.data.totals.clicks)} />
            <StatCard
              label="CTR"
              value={formatCtr(report.data.totals.ctr)}
              hint="Cliques ÷ impressões"
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Por dia</CardTitle>
            </CardHeader>
            <CardContent>
              <Table aria-label="Relatório diário">
                <TableHeader>
                  <TableRow>
                    <TableHead>Dia</TableHead>
                    <TableHead className="text-right">Impressões</TableHead>
                    <TableHead className="text-right">Cliques</TableHead>
                    <TableHead className="text-right">CTR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.data.days.map((day) => (
                    <TableRow key={day.day}>
                      <TableCell>{formatDayLabel(day.day)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCount(day.impressions)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCount(day.clicks)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCtr(day.ctr)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {report.data.creatives.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Por peça</CardTitle>
              </CardHeader>
              <CardContent>
                <Table aria-label="Relatório por peça">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Peça</TableHead>
                      <TableHead className="text-right">Impressões</TableHead>
                      <TableHead className="text-right">Cliques</TableHead>
                      <TableHead className="text-right">CTR</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.data.creatives.map((creative) => (
                      <TableRow key={creative.creativeId}>
                        <TableCell>{creative.title}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCount(creative.impressions)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCount(creative.clicks)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCtr(creative.ctr)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
