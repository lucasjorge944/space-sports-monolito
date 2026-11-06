import type { OpeningHour, PublicSpace } from '@space-sports/api-client';
import { WEEKDAY_LABEL } from './painel/labels';

/** Deep link do app para a página do espaço (rota do app e domínio ainda pendentes: pergunta 9). */
export function appDeepLink(slug: string): string {
  return `spacesports://espacos/${encodeURIComponent(slug)}`;
}

/** Endereço em uma linha (só com o que está preenchido). */
export function addressLine(address: PublicSpace['address']): string {
  const street = [address.street, address.number].filter(Boolean).join(', ');
  const place = [street, address.neighborhood].filter(Boolean).join(' - ');
  const city = `${address.city.name} - ${address.city.state}`;
  return [place, city].filter(Boolean).join(', ');
}

export function mapsLinks(
  space: Pick<PublicSpace, 'location' | 'name'> & { address: PublicSpace['address'] },
) {
  const query = space.location
    ? `${space.location.lat},${space.location.lng}`
    : encodeURIComponent(`${space.name}, ${addressLine(space.address)}`);
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${query}`,
    waze: space.location
      ? `https://waze.com/ul?ll=${space.location.lat},${space.location.lng}&navigate=yes`
      : `https://waze.com/ul?q=${query}&navigate=yes`,
  };
}

/** `https://wa.me/...` a partir do E.164. */
export function whatsappLink(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, '')}`;
}

/** Descrição para `<meta>`: a do espaço (cortada em ~160 caracteres) ou um texto padrão. */
export function metaDescription(
  space: Pick<PublicSpace, 'name' | 'description' | 'address'>,
): string {
  const base = space.description?.replace(/\s+/g, ' ').trim();
  if (base) return base.length <= 160 ? base : `${base.slice(0, 157).trimEnd()}...`;
  return `${space.name} em ${space.address.city.name}: veja quadras, horários e reserve pelo app Space Sports.`;
}

/** Horário agrupado por dia da semana, na ordem da semana, só dos dias abertos. */
export function hoursByDay(hours: readonly OpeningHour[]) {
  return WEEKDAY_LABEL.map((label, weekday) => ({
    label,
    ranges: hours
      .filter((h) => h.weekday === weekday)
      .sort((a, b) => a.opensAt.localeCompare(b.opensAt))
      .map((h) => `${h.opensAt} às ${h.closesAt}`),
  }));
}

const SCHEMA_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Dados estruturados (schema.org) da página do espaço, para buscadores. */
export function spaceJsonLd(space: PublicSpace, url: string | undefined) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsActivityLocation',
    name: space.name,
    ...(space.description ? { description: space.description } : {}),
    ...(url ? { url } : {}),
    ...(space.photos[0] ? { image: space.photos.map((p) => p.url) } : {}),
    ...(space.phone ? { telephone: space.phone } : {}),
    address: {
      '@type': 'PostalAddress',
      ...(space.address.street
        ? { streetAddress: [space.address.street, space.address.number].filter(Boolean).join(', ') }
        : {}),
      addressLocality: space.address.city.name,
      addressRegion: space.address.city.state,
      addressCountry: 'BR',
      ...(space.address.postalCode ? { postalCode: space.address.postalCode } : {}),
    },
    ...(space.location
      ? {
          geo: {
            '@type': 'GeoCoordinates',
            latitude: space.location.lat,
            longitude: space.location.lng,
          },
        }
      : {}),
    openingHoursSpecification: space.openingHours.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: SCHEMA_DAYS[h.weekday],
      opens: h.opensAt,
      closes: h.closesAt,
    })),
  };
}
