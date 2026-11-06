import type { SpaceRole } from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import type { Database } from '../../src/db/client.js';
import {
  amenities,
  cities,
  courtSports,
  courts,
  type GeoPoint,
  spaceAmenities,
  spaceMembers,
  spacePhotos,
  spaceSettings,
  spaces,
  sports,
} from '../../src/db/schema/index.js';
import { SEED_AMENITIES, SEED_SPORTS } from '../../src/db/seed.js';
import type { GeocodeAddress } from '../../src/geocoding/geocoder.js';
import { Geocoder } from '../../src/geocoding/geocoder.js';
import { PhotoStorage, type StoredObject } from '../../src/storage/photo-storage.js';
import { type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { first } from '../db/helpers.js';

/** Pontos reais de BH para os testes de raio. */
export const BH = {
  /** Praça Sete (centro). */
  center: { lat: -19.9191, lng: -43.9386 },
  /** Savassi, ~1,5 km do centro. */
  savassi: { lat: -19.9353, lng: -43.9339 },
  /** Pampulha, ~9 km do centro. */
  pampulha: { lat: -19.8516, lng: -43.9692 },
  /** Contagem, ~17 km do centro. */
  contagem: { lat: -19.9317, lng: -44.0536 },
} satisfies Record<string, GeoPoint>;

export class FakeGeocoder extends Geocoder {
  enabled = true;
  readonly calls: GeocodeAddress[] = [];
  /** Resposta por CEP; CEP sem entrada = endereço não encontrado. */
  readonly byPostalCode = new Map<string, GeoPoint>();
  failing = false;

  async geocode(address: GeocodeAddress): Promise<GeoPoint | null> {
    this.calls.push(address);
    if (this.failing) throw new Error('provedor fora do ar');
    return this.byPostalCode.get(address.postalCode) ?? null;
  }
}

const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export class FakeStorage extends PhotoStorage {
  enabled = true;
  readonly objects = new Map<string, StoredObject>();
  /** Conteúdo dos objetos enviados com `body` (as logos são conferidas pelos bytes). */
  readonly bodies = new Map<string, Uint8Array>();
  readonly deleted: string[] = [];
  /** Cópias feitas (`copy`), na ordem: a chave publicada é nova a cada registro. */
  readonly copies: { source: string; target: string }[] = [];
  /** Tamanhos máximos pedidos nas leituras (o `read` real limita o GET com Range). */
  readonly reads: { key: string; maxBytes: number }[] = [];
  /** Erro a lançar no próximo `copy` / `head` (simula falha do storage). */
  failCopy: Error | null = null;
  failHead: Error | null = null;
  /** Rodam uma vez antes / depois do próximo `copy` (simulam um pedido concorrente). */
  beforeCopy: (() => Promise<void>) | null = null;
  afterCopy: (() => Promise<void>) | null = null;

  async presignUpload(key: string, contentType: string) {
    return {
      url: `https://s3.test/bucket/${key}?X-Amz-Signature=fake`,
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(Date.now() + 600_000),
    };
  }
  async head(key: string) {
    if (this.failHead) {
      const err = this.failHead;
      this.failHead = null;
      throw err;
    }
    return this.objects.get(key) ?? null;
  }
  async read(key: string, maxBytes: number) {
    this.reads.push({ key, maxBytes });
    if (!this.objects.has(key)) return null;
    const body = this.bodies.get(key) ?? new Uint8Array(this.objects.get(key)?.size ?? 0);
    return body.subarray(0, maxBytes + 1);
  }
  async copy(sourceKey: string, targetKey: string) {
    if (this.failCopy) {
      const err = this.failCopy;
      this.failCopy = null;
      throw err;
    }
    const before = this.beforeCopy;
    this.beforeCopy = null;
    await before?.();
    const object = this.objects.get(sourceKey);
    if (!object) return false;
    this.copies.push({ source: sourceKey, target: targetKey });
    this.objects.set(targetKey, { ...object });
    const body = this.bodies.get(sourceKey);
    if (body) this.bodies.set(targetKey, body.slice());
    else this.bodies.delete(targetKey);
    const after = this.afterCopy;
    this.afterCopy = null;
    await after?.();
    return true;
  }
  async delete(key: string) {
    this.deleted.push(key);
    this.objects.delete(key);
    this.bodies.delete(key);
  }
  async deletePrefix(prefix: string) {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix));
    for (const key of keys) await this.delete(key);
    return keys.length;
  }
  publicUrl(key: string) {
    return `https://fotos.test/${key}`;
  }
  /** Chave publicada da última cópia feita a partir da chave de upload (falha se não houve). */
  publishedOf(uploadKey: string): string {
    const copy = this.copies.findLast((c) => c.source === uploadKey);
    if (!copy) throw new Error(`Nenhuma cópia de ${uploadKey}.`);
    return copy.target;
  }
  keyFromUrl(url: string) {
    return url.startsWith('https://fotos.test/') ? url.slice('https://fotos.test/'.length) : null;
  }
  /** Simula o PUT do cliente na URL pré-assinada. */
  upload(
    key: string,
    size = 1000,
    contentType = TYPES[key.slice(key.lastIndexOf('.') + 1)] ?? null,
  ) {
    this.objects.set(key, { size, contentType });
  }
  /** Simula o PUT de um arquivo com conteúdo (tamanho = bytes). */
  uploadBody(
    key: string,
    body: Uint8Array,
    contentType = TYPES[key.slice(key.lastIndexOf('.') + 1)] ?? null,
  ) {
    this.objects.set(key, { size: body.length, contentType });
    this.bodies.set(key, body);
  }
}

/** Catálogo do seed (esportes e amenities) + BH. */
export async function seedCatalog(db: Database) {
  const sportRows = await db
    .insert(sports)
    .values([...SEED_SPORTS])
    .returning();
  const amenityRows = await db
    .insert(amenities)
    .values([...SEED_AMENITIES])
    .returning();
  const city = first(
    await db
      .insert(cities)
      .values({ name: 'Belo Horizonte', state: 'MG', timezone: 'America/Sao_Paulo' })
      .returning(),
  );
  const sport = (slug: string) => first(sportRows.filter((s) => s.slug === slug));
  const amenity = (slug: string) => first(amenityRows.filter((a) => a.slug === slug));
  return { city, sport, amenity, sports: sportRows, amenities: amenityRows };
}

export type Catalog = Awaited<ReturnType<typeof seedCatalog>>;

let counter = 0;

/**
 * Espaço direto no banco. Por padrão visível na vitrine (quadra ativa de futevôlei e preço);
 * `price: null` ou `courts: []` o deixam de fora.
 */
export async function createSpace(
  db: Database,
  catalog: Catalog,
  options: {
    name?: string;
    slug?: string;
    location?: GeoPoint | null;
    price?: number | null;
    status?: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
    courts?: { status?: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE'; sports: string[] }[];
    amenities?: string[];
    photos?: number;
    neighborhood?: string;
    /** `rating_count`/`rating_sum` direto nas colunas, como a API os manteria (RN-REVIEW-03). */
    rating?: { count: number; sum: number };
  } = {},
) {
  counter += 1;
  const name = options.name ?? `Espaço ${counter}`;
  const space = first(
    await db
      .insert(spaces)
      .values({
        name,
        slug: options.slug ?? `espaco-${counter}`,
        cityId: catalog.city.id,
        location: options.location === undefined ? BH.center : options.location,
        status: options.status ?? 'ACTIVE',
        addressNeighborhood: options.neighborhood ?? null,
        ratingCount: options.rating?.count ?? 0,
        ratingSum: options.rating?.sum ?? 0,
      })
      .returning(),
  );
  const price = options.price === undefined ? 10_000 : options.price;
  await db.insert(spaceSettings).values({ spaceId: space.id, pricePerHourCents: price });
  for (const [index, court] of (options.courts ?? [{ sports: ['futevolei'] }]).entries()) {
    const row = first(
      await db
        .insert(courts)
        .values({
          spaceId: space.id,
          name: `Quadra ${index + 1}`,
          status: court.status ?? 'ACTIVE',
        })
        .returning(),
    );
    if (court.sports.length) {
      await db.insert(courtSports).values(
        court.sports.map((slug) => ({
          courtId: row.id,
          sportId: catalog.sport(slug).id,
          maxPlayers: 4,
        })),
      );
    }
  }
  if (options.amenities?.length) {
    await db.insert(spaceAmenities).values(
      options.amenities.map((slug) => ({
        spaceId: space.id,
        amenityId: catalog.amenity(slug).id,
      })),
    );
  }
  for (let position = 0; position < (options.photos ?? 0); position++) {
    await db.insert(spacePhotos).values({
      spaceId: space.id,
      url: `https://fotos.test/${space.slug}/${position}.jpg`,
      position,
    });
  }
  return space;
}

/** Usuário com um papel ACTIVE no espaço. */
export async function member(
  t: TestApp,
  email: string,
  spaceId: string,
  role: SpaceRole,
): Promise<SignedUp> {
  const user = await signUp(t, email);
  await t.db.insert(spaceMembers).values({ userId: user.id, spaceId, role, status: 'ACTIVE' });
  return user;
}

export async function setSpaceStatus(
  db: Database,
  spaceId: string,
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED',
) {
  await db.update(spaces).set({ status }).where(eq(spaces.id, spaceId));
}
