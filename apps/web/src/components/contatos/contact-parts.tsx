'use client';

import type { ContactOrigin } from '@space-sports/shared';
import { Download, Loader2, MessageCircle, Search } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { consentState, ORIGIN_LABEL, ORIGIN_OPTIONS } from '@/lib/contacts';
import { formatDate, formatPhone } from '@/lib/format';
import { downloadCsv } from '@/lib/painel/csv';
import { apiErrorMessage } from '@/lib/painel/errors';
import { withBom } from '@/lib/painel/statement';
import { whatsappLink } from '@/lib/public-space';

/** Indicador de consentimento de marketing, com a data em que foi dado. */
export function ConsentBadge({
  marketingConsentAt,
  unsubscribedAt,
}: {
  marketingConsentAt: string | null;
  unsubscribedAt?: string | null;
}) {
  const state = consentState({ marketingConsentAt, unsubscribedAt });
  if (state === 'unsubscribed') return <Badge variant="warning">Descadastrado</Badge>;
  if (state === 'none') return <Badge variant="muted">Sem consentimento</Badge>;
  return (
    <span className="flex flex-col gap-0.5">
      <Badge variant="success">Com consentimento</Badge>
      <span className="text-muted-foreground text-xs tabular-nums">
        desde {formatDate(marketingConsentAt)}
      </span>
    </span>
  );
}

export function ContactIdentity({
  name,
  email,
  phone,
}: {
  name: string | null;
  email: string | null;
  phone: string | null;
}) {
  return (
    <>
      <span className="block font-medium">{name ?? 'Sem nome'}</span>
      {email ? <span className="text-muted-foreground block text-xs">{email}</span> : null}
      {phone ? (
        <span className="text-muted-foreground block text-xs tabular-nums">
          {formatPhone(phone)}
        </span>
      ) : null}
    </>
  );
}

export function OriginList({ origins }: { origins: ContactOrigin[] }) {
  if (origins.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="grid gap-0.5 text-xs">
      {origins.map((origin) => (
        <li key={origin}>{ORIGIN_LABEL[origin]}</li>
      ))}
    </ul>
  );
}

export function WhatsAppButton({ phone, name }: { phone: string | null; name: string | null }) {
  if (!phone) return null;
  return (
    <Button asChild size="sm" variant="outline">
      <a
        href={whatsappLink(phone)}
        target="_blank"
        rel="noreferrer"
        aria-label={`WhatsApp de ${name ?? formatPhone(phone)}`}
      >
        <MessageCircle aria-hidden />
        WhatsApp
      </a>
    </Button>
  );
}

export type ContactFilterValues = { q: string; consent: string; origin: string };

/** Busca, consentimento e origem, comuns às duas listas; `children` são os filtros a mais do Super. */
export function ContactFilters({
  values,
  onChange,
  children,
}: {
  values: ContactFilterValues;
  onChange: (patch: Partial<ContactFilterValues>) => void;
  children?: React.ReactNode;
}) {
  return (
    <form
      aria-label="Filtros de contatos"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="relative">
        <Search
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        />
        <Input
          type="search"
          aria-label="Buscar por nome, e-mail ou telefone"
          placeholder="Nome, e-mail ou telefone"
          className="pl-8"
          maxLength={100}
          value={values.q}
          onChange={(event) => onChange({ q: event.target.value })}
        />
      </div>
      <Select
        aria-label="Consentimento"
        value={values.consent}
        onChange={(event) => onChange({ consent: event.target.value })}
      >
        <option value="">Qualquer consentimento</option>
        <option value="true">Com consentimento</option>
        <option value="false">Sem consentimento</option>
      </Select>
      <Select
        aria-label="Origem"
        value={values.origin}
        onChange={(event) => onChange({ origin: event.target.value })}
      >
        <option value="">Todas as origens</option>
        {ORIGIN_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      {children}
    </form>
  );
}

/** O CSV vem da API, com os filtros da tela e só com quem deu consentimento. */
export function ExportContactsButton({
  filename,
  disabled,
  fetchCsv,
}: {
  filename: string;
  disabled: boolean;
  fetchCsv: () => Promise<string>;
}) {
  const [exporting, setExporting] = useState(false);

  async function exportCsv() {
    setExporting(true);
    try {
      downloadCsv(filename, withBom(await fetchCsv()));
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Button variant="outline" onClick={exportCsv} disabled={disabled || exporting}>
      {exporting ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
      {exporting ? 'Exportando…' : 'Exportar CSV'}
    </Button>
  );
}
