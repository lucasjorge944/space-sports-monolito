'use client';

import { isApiError, useSuperGetSpace } from '@space-sports/api-client';
import { Pencil, Star } from 'lucide-react';
import Link from 'next/link';
import { SpaceAvatar } from '@/components/space-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import { superRatingLink } from '@/lib/reviews';
import { ownerInviteMessage, showcaseMissingLabel } from '@/lib/super/labels';
import { SpaceStatusBadge } from '../badges';
import { PageHeader } from '../page-header';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';
import { OnboardingChecklist } from './onboarding-checklist';
import { OwnerInviteCard } from './owner-invite-card';
import { SpaceStatusActions } from './space-status-actions';
import { SupportStartButton } from './support-start-button';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-sm">{children || '—'}</dd>
    </div>
  );
}

type SpaceDetailProps = {
  spaceId: string;
  /** Resultado do convite do Dono logo após criar o espaço (`?convite=`). */
  inviteStatus?: keyof typeof ownerInviteMessage | undefined;
};

export function SpaceDetail({ spaceId, inviteStatus }: SpaceDetailProps) {
  const query = useSuperGetSpace(spaceId);
  const back = { href: '/super/espacos', label: 'Espaços' };

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Espaço" back={back} />
        <LoadingBlock />
      </div>
    );
  }
  if (query.isError) {
    const notFound = isApiError(query.error) && query.error.status === 404;
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Espaço" back={back} />
        {notFound ? (
          <EmptyBlock>Espaço não encontrado.</EmptyBlock>
        ) : (
          <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
        )}
      </div>
    );
  }

  const space = query.data;
  const { address } = space;
  const ratingLink = superRatingLink(space.rating);
  const addressLine = [
    [address.street, address.number].filter(Boolean).join(', '),
    address.neighborhood,
    `${address.city.name} - ${address.city.state}`,
    address.postalCode,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <SpaceAvatar name={space.name} logoUrl={space.logoUrl} size={48} decorative />
            {space.name}
            <SpaceStatusBadge status={space.status} />
          </span>
        }
        description={`/${space.slug} · criado em ${formatDateTime(space.createdAt)}`}
        actions={
          <>
            <SupportStartButton space={space} />
            <Button variant="outline" asChild>
              <Link
                href={`/super/espacos/${space.id}/avaliacoes`}
                aria-label={ratingLink.ariaLabel}
                data-testid="super-espaco-avaliacoes"
              >
                <Star aria-hidden="true" />
                Avaliações
                {ratingLink.text ? (
                  <span className="text-muted-foreground tabular-nums">{ratingLink.text}</span>
                ) : null}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/super/espacos/${space.id}/editar`}>
                <Pencil aria-hidden="true" />
                Editar
              </Link>
            </Button>
            <SpaceStatusActions space={space} />
          </>
        }
      />

      {inviteStatus ? (
        <p role="status" className="bg-card rounded-lg border p-3 text-sm">
          Espaço criado. {ownerInviteMessage[inviteStatus]}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Implantação</CardTitle>
            <CardDescription>
              Cada etapa, a situação dela e o que falta para concluir.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <OnboardingChecklist checklist={space.checklist} />
            <div className="text-sm">
              <span className="font-medium">Vitrine: </span>
              {space.showcase.visible ? (
                <Badge variant="success">Visível</Badge>
              ) : (
                <>
                  <Badge variant="outline">Fora da vitrine</Badge>
                  <span className="text-muted-foreground block pt-1 text-xs">
                    Falta: {space.showcase.missing.map((m) => showcaseMissingLabel[m]).join(', ')}
                  </span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <OwnerInviteCard space={space} />

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Dados do espaço</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3">
              <Row label="Endereço">{addressLine}</Row>
              <Row label="Descrição">{space.description}</Row>
              <Row label="Telefone">{space.phone}</Row>
              <Row label="WhatsApp">{space.whatsapp}</Row>
              <Row label="Instagram">{space.instagram ? `@${space.instagram}` : null}</Row>
              <Row label="Quadras">{String(space.courtsCount)}</Row>
              <Row label="Fotos">{String(space.photos.length)}</Row>
              <Row label="Infraestrutura">
                {space.amenities.map((amenity) => amenity.name).join(', ')}
              </Row>
              <Row label="Funcionamento">
                {space.openingHours.length > 0 ? (
                  <ul className="grid gap-0.5">
                    {space.openingHours.map((hour) => (
                      <li key={`${hour.weekday}-${hour.opensAt}`}>
                        {WEEKDAYS[hour.weekday]}: {hour.opensAt} às {hour.closesAt}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Row>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
