import type { AdDeliveryListItemsItemDestination } from '@space-sports/api-client';
import { ArrowUpRight, ChevronRight, MessageCircle } from 'lucide-react-native';
import { Linking } from 'react-native';
import { spaceLocationLabel } from '@/features/discovery/space-card';

export type AdDestination = AdDeliveryListItemsItemDestination;

/** Só `https://`, sem espaços (a API grava assim; o app confere de novo antes de abrir). */
export function isSafeHttpsUrl(url: string): boolean {
  return /^https:\/\/[^\s/?#]+[^\s]*$/i.test(url);
}

/** Link do WhatsApp que a API monta (`https://wa.me/<telefone>?text=…`); o app só confere o prefixo. */
export function isWhatsappUrl(url: string): boolean {
  return /^https:\/\/wa\.me\/\d/.test(url) && isSafeHttpsUrl(url);
}

/** URL externa do destino; `null` para o espaço (rota interna) ou URL recusada. */
export function externalAdUrl(destination: AdDestination): string | null {
  switch (destination.type) {
    case 'URL':
      return isSafeHttpsUrl(destination.url) ? destination.url : null;
    case 'WHATSAPP':
      return isWhatsappUrl(destination.url) ? destination.url : null;
    case 'SPACE':
      return null;
  }
}

/**
 * Abre o destino da peça (RF-ADS-05): URL no navegador do sistema, WhatsApp pelo `wa.me` e espaço
 * pela página interna. Devolve `false` se não deu para abrir (URL recusada ou sem app para ela): aí o
 * clique não conta.
 */
export async function openAdDestination(
  destination: AdDestination,
  openSpace: (slug: string) => void,
): Promise<boolean> {
  if (destination.type === 'SPACE') {
    openSpace(destination.space.slug);
    return true;
  }
  const url = externalAdUrl(destination);
  if (!url) return false;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/** Domínio sem `www.`: "https://www.example.com/loja" → "example.com". */
export function urlDomain(url: string): string {
  const host = /^https?:\/\/([^/?#:]+)/i.exec(url)?.[1] ?? url;
  return host.replace(/^www\./i, '').toLowerCase();
}

/** Texto do rodapé do card patrocinado: domínio, "WhatsApp" ou bairro · cidade do espaço. */
export function destinationLabel(destination: AdDestination): string {
  switch (destination.type) {
    case 'URL':
      return urlDomain(destination.url);
    case 'WHATSAPP':
      return 'WhatsApp';
    case 'SPACE':
      return spaceLocationLabel(destination.space);
  }
}

/** Dica de acessibilidade pelo destino. */
export function destinationHint(destination: AdDestination): string {
  switch (destination.type) {
    case 'URL':
      return 'Abre o site do anunciante';
    case 'WHATSAPP':
      return 'Abre o WhatsApp do anunciante';
    case 'SPACE':
      return 'Abre a página do espaço';
  }
}

/** Ícone do destino, o mesmo no banner e no card. */
export function destinationIcon(destination: AdDestination) {
  switch (destination.type) {
    case 'URL':
      return ArrowUpRight;
    case 'WHATSAPP':
      return MessageCircle;
    case 'SPACE':
      return ChevronRight;
  }
}

/** "Patrocinado, <anunciante>. <título>. <texto>. <botão>" (+ posição no carrossel). */
export function adAccessibilityLabel(
  ad: { advertiser: { name: string }; title: string; body: string | null; ctaLabel: string },
  position?: { index: number; total: number },
): string {
  return [
    `Patrocinado, ${ad.advertiser.name}`,
    ad.title,
    ad.body,
    ad.ctaLabel,
    position && position.total > 1 ? `Anúncio ${position.index + 1} de ${position.total}` : null,
  ]
    .filter((part): part is string => !!part && part.trim() !== '')
    .join('. ');
}
