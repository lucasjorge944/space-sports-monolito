import { AtSign, Clock, MapPin, MessageCircle, Phone, Smartphone } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SpaceHeaderRating, SpaceReviewsSection } from '@/components/reviews/space-reviews-section';
import { SpaceAvatar } from '@/components/space-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { formatDuration, formatMoney, formatPhone } from '@/lib/format';
import { PAYMENT_METHOD_LABEL } from '@/lib/painel/labels';
import {
  addressLine,
  appDeepLink,
  hoursByDay,
  mapsLinks,
  metaDescription,
  spaceJsonLd,
  whatsappLink,
} from '@/lib/public-space';
import { headerRating, reviewsJsonLd } from '@/lib/reviews';
import { fetchPublicSpace, fetchReviewSummary } from '@/lib/server-api';
import { cn, textLink } from '@/lib/utils';

type Props = { params: Promise<{ slug: string }> };

// Domínio ainda não existe (docs/07, pergunta 9): sem `SITE_URL` não há URL absoluta/canônica.
const siteUrl = process.env.SITE_URL?.replace(/\/+$/, '');

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const space = await fetchPublicSpace(slug);
  if (!space) return { title: 'Espaço não encontrado', robots: { index: false } };
  const description = metaDescription(space);
  const cover = space.photos[0]?.url;
  return {
    title: `${space.name} · ${space.address.city.name}`,
    description,
    ...(siteUrl
      ? { metadataBase: new URL(siteUrl), alternates: { canonical: `/espacos/${space.slug}` } }
      : {}),
    openGraph: {
      type: 'website',
      title: space.name,
      description,
      locale: 'pt_BR',
      ...(cover ? { images: [{ url: cover }] } : {}),
    },
    twitter: { card: cover ? 'summary_large_image' : 'summary', title: space.name, description },
  };
}

export default async function EspacoPublicoPage({ params }: Props) {
  const { slug } = await params;
  const space = await fetchPublicSpace(slug);
  if (!space) notFound();

  // Resumo das avaliações (RF-REVIEW-03): falhar aqui não derruba a página, só o bloco.
  const summary = await fetchReviewSummary(space.id);
  const maps = mapsLinks(space);
  const [cover, ...gallery] = space.photos;
  // `AggregateRating` e `Review` só quando o resumo aparece (RN-REVIEW-03: 5 ou mais avaliações).
  const jsonLd = JSON.stringify({
    ...spaceJsonLd(space, siteUrl ? `${siteUrl}/espacos/${space.slug}` : undefined),
    ...reviewsJsonLd(summary),
  }).replace(/</g, '\\u003c');

  return (
    <article className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8">
      {/* JSON-LD: o JSON é serializado por nós e `<` é escapado, então não há HTML de terceiros aqui. */}
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD estático com `<` escapado */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <SpaceAvatar name={space.name} logoUrl={space.logoUrl} size={72} decorative />
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-2">
            <h1 className="text-h2 sm:text-h1">{space.name}</h1>
            <p className="text-muted-foreground flex items-center gap-1 text-sm">
              <MapPin className="size-4" aria-hidden /> {addressLine(space.address)}
            </p>
            <SpaceHeaderRating rating={headerRating(space.rating, summary)} />
            <div className="flex flex-wrap gap-2">
              {space.sports.map((s) => (
                <Chip key={s.slug}>{s.name}</Chip>
              ))}
            </div>
          </div>
          <Button asChild size="xl">
            <a href={appDeepLink(space.slug)} data-testid="open-in-app">
              <Smartphone /> Abrir no app
            </a>
          </Button>
        </div>
      </header>

      {cover ? (
        <section aria-label="Fotos" className="grid gap-2 sm:grid-cols-4">
          {/* biome-ignore lint/performance/noImgElement: URLs externas do storage, sem otimização do Next */}
          <img
            src={cover.url}
            alt={`Foto principal de ${space.name}`}
            className="aspect-[16/9] w-full rounded-lg object-cover sm:col-span-2 sm:row-span-2"
            fetchPriority="high"
          />
          {gallery.slice(0, 4).map((photo, i) => (
            // biome-ignore lint/performance/noImgElement: URLs externas do storage, sem otimização do Next
            <img
              key={photo.id}
              src={photo.url}
              alt={`Foto ${i + 2} de ${space.name}`}
              className="aspect-[4/3] w-full rounded-lg object-cover"
              loading="lazy"
            />
          ))}
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {space.description ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-h3">Sobre o espaço</h2>
              <p className="whitespace-pre-line">{space.description}</p>
            </section>
          ) : null}

          {space.courts.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-h3">Quadras</h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {space.courts.map((court) => (
                  <li key={court.id} className="bg-card rounded-lg border p-4">
                    <p className="font-medium">{court.name}</p>
                    <p className="text-muted-foreground text-sm">
                      {court.covered ? 'Coberta' : 'Descoberta'} ·{' '}
                      {court.sports.map((s) => s.name).join(', ')}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {space.amenities.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-h3">Infraestrutura</h2>
              <ul className="flex flex-wrap gap-2">
                {space.amenities.map((a) => (
                  <li key={a.id}>
                    <Badge variant="outline">{a.name}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <SpaceReviewsSection space={space} summary={summary} />
        </div>

        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Alugar quadra</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              <p className="font-display text-2xl font-bold tabular-nums">
                {formatMoney(space.rental.pricePerHourCents)}
                <span className="text-muted-foreground text-sm font-normal"> / hora</span>
              </p>
              <p className="text-muted-foreground">
                De {formatDuration(space.rental.minDurationMin)} a{' '}
                {formatDuration(space.rental.maxDurationMin)} por reserva. Reserve pelo app.
              </p>
              {space.acceptedPaymentMethods.length > 0 ? (
                <p className="mt-2">
                  Pagamento no local:{' '}
                  {space.acceptedPaymentMethods.map((m) => PAYMENT_METHOD_LABEL[m]).join(', ')}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock className="size-4" aria-hidden /> Funcionamento
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-1 text-sm">
                {hoursByDay(space.openingHours).map((day) => (
                  <div key={day.label} className="flex justify-between gap-4">
                    <dt>{day.label}</dt>
                    <dd className="text-muted-foreground tabular-nums">
                      {day.ranges.length > 0 ? day.ranges.join(' · ') : 'Fechado'}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Contato e localização</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {space.phone ? (
                <a className={cn(textLink, 'flex items-center gap-2')} href={`tel:${space.phone}`}>
                  <Phone className="size-4" aria-hidden /> {formatPhone(space.phone)}
                </a>
              ) : null}
              {space.whatsapp ? (
                <a
                  className={cn(textLink, 'flex items-center gap-2')}
                  href={whatsappLink(space.whatsapp)}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <MessageCircle className="size-4" aria-hidden /> WhatsApp{' '}
                  {formatPhone(space.whatsapp)}
                </a>
              ) : null}
              {space.instagram ? (
                <a
                  className={cn(textLink, 'flex items-center gap-2')}
                  href={`https://instagram.com/${space.instagram}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <AtSign className="size-4" aria-hidden /> @{space.instagram}
                </a>
              ) : null}
              <div className="flex gap-2 pt-2">
                <Button variant="outline" size="xl" asChild>
                  <a href={maps.google} rel="noopener noreferrer" target="_blank">
                    Google Maps
                  </a>
                </Button>
                <Button variant="outline" size="xl" asChild>
                  <a href={maps.waze} rel="noopener noreferrer" target="_blank">
                    Waze
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </article>
  );
}
