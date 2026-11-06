import type { GeoPoint } from '@space-sports/api-client';
import { Linking, Platform } from 'react-native';

/** Só dígitos e `+`: o que `tel:` e o WhatsApp aceitam. */
function digits(phone: string): string {
  return phone.replace(/[^\d]/g, '');
}

export function telUrl(phone: string): string {
  return `tel:+${digits(phone)}`;
}

/** WhatsApp (wa.me). Número sem DDI recebe o do Brasil (55). */
export function whatsappUrl(phone: string): string {
  const d = digits(phone);
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}`;
}

/** `@arena`, `arena` ou `https://instagram.com/arena/` → URL do perfil. */
export function instagramUrl(value: string): string {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://instagram.com/${trimmed.replace(/^@/, '').replace(/\/+$/, '')}`;
}

/** Rótulo curto do perfil: `@arena`. */
export function instagramHandle(value: string): string {
  const match = /instagram\.com\/([^/?#]+)/i.exec(value);
  const handle = (match?.[1] ?? value).trim().replace(/^@/, '');
  return `@${handle}`;
}

export function wazeUrl(point: GeoPoint): string {
  return `https://waze.com/ul?ll=${point.lat},${point.lng}&navigate=yes`;
}

/** Rota até o espaço no app de mapas padrão (Apple Maps no iOS; geo: no Android). */
export function mapsUrl(point: GeoPoint, label: string): string {
  const { lat, lng } = point;
  if (Platform.OS === 'ios') {
    return `http://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(label)}`;
  }
  if (Platform.OS === 'android')
    return `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/** Abre o link; devolve `false` se o aparelho não tem app para ele. */
export async function openLink(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
