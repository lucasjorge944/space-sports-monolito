import { Logger } from '@nestjs/common';
import type { Env } from '../config/env.js';
import type { GeoPoint } from '../db/schema/index.js';

export type GeocodeAddress = {
  street: string;
  number: string;
  neighborhood: string;
  postalCode: string;
  city: string;
  state: string;
};

/**
 * Endereço → lat/lng (RF-SPACE-01). Classe abstrata para servir de token de injeção (e de fake
 * nos testes).
 */
export abstract class Geocoder {
  /** `false` sem provedor configurado: o endereço é salvo sem localização. */
  abstract readonly enabled: boolean;
  /** `null` quando o provedor não encontra o endereço. */
  abstract geocode(address: GeocodeAddress): Promise<GeoPoint | null>;
}

/** Google Maps Platform, Geocoding API. */
export class GoogleGeocoder extends Geocoder {
  readonly enabled = true;
  private readonly logger = new Logger(GoogleGeocoder.name);

  constructor(private readonly apiKey: string) {
    super();
  }

  async geocode(address: GeocodeAddress): Promise<GeoPoint | null> {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set(
      'address',
      `${address.street}, ${address.number} - ${address.neighborhood}, ${address.city} - ${address.state}, ${address.postalCode}`,
    );
    url.searchParams.set('components', `country:BR|postal_code:${address.postalCode}`);
    url.searchParams.set('region', 'br');
    url.searchParams.set('language', 'pt-BR');
    url.searchParams.set('key', this.apiKey);

    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`Geocoding respondeu ${res.status}`);
    const body = (await res.json()) as {
      status: string;
      results?: { geometry: { location: { lat: number; lng: number } } }[];
      error_message?: string;
    };
    if (body.status === 'ZERO_RESULTS') return null;
    const location = body.results?.[0]?.geometry.location;
    if (body.status !== 'OK' || !location) {
      this.logger.error({ status: body.status, error: body.error_message }, 'Falha no geocoding');
      throw new Error(`Geocoding falhou: ${body.status}`);
    }
    return { lat: location.lat, lng: location.lng };
  }
}

export class DisabledGeocoder extends Geocoder {
  readonly enabled = false;
  async geocode(): Promise<GeoPoint | null> {
    return null;
  }
}

export function createGeocoder(env: Env): Geocoder {
  return env.GOOGLE_MAPS_API_KEY
    ? new GoogleGeocoder(env.GOOGLE_MAPS_API_KEY)
    : new DisabledGeocoder();
}
