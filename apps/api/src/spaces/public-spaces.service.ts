import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type PublicSpace,
  RECENT_SPACES_LIMIT,
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  REVIEW_SUMMARY_MIN_COUNT,
  SEARCH_DEFAULT_RADIUS_KM,
  type SpaceCard,
  type SpaceSearchQuery,
  type SpaceSearchResult,
  type SpaceSearchSort,
  type SpaceService,
  spaceRating,
} from '@space-sports/shared';
import { and, desc, eq, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import {
  amenities,
  attendances,
  bookingParticipants,
  bookings,
  cities,
  classSessions,
  courtSports,
  courts,
  favorites,
  spaceAmenities,
  spaceSettings,
  spaces,
  sports,
  subscriptions,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { PaymentSettingsService } from '../payments/payment-settings.service.js';
import { displayedAverageTenths } from '../reviews/review-views.js';
import {
  loadAmenities,
  loadCourts,
  loadCovers,
  loadOpeningHours,
  loadPhotos,
  loadSettings,
  loadSportsBySpace,
  visibleInShowcase,
} from './space-queries.js';
import { cursorSortMismatch, invalidCursor, spaceNotFound } from './spaces.errors.js';

/**
 * Serviços oferecidos. Por enquanto só o aluguel existe (Fase 1); Aulas e Torneios entram quando
 * os módulos existirem (Fases 2 e 3), a partir de turmas/planos e torneios abertos do espaço.
 */
const SERVICES: SpaceService[] = ['RENTAL'];

/**
 * Cursor opaco: modo de ordenação, últimos valores das chaves da ordem, id e a assinatura dos
 * filtros (`f`). Cursor usado com outros filtros é rejeitado: o keyset só vale para a mesma busca.
 * Modos: `distance`/`name` (ordem `distance`, com e sem `lat`/`lng`) e `rating-distance`/
 * `rating-name` (ordem `rating`), que carregam também a nota do último item.
 */
const tail = { id: z.uuid(), f: z.string() };
/**
 * Nota pública do último item da página, nas chaves da ordem: a média exibida vezes 10
 * (`tenths`, 49 = "★ 4,9") e o total. `null` se ele era "Novo": a média escondida nunca entra
 * no cursor.
 */
const ratingKeySchema = z
  .object({
    tenths: z
      .number()
      .int()
      .min(REVIEW_RATING_MIN * 10)
      .max(REVIEW_RATING_MAX * 10),
    count: z.number().int().min(REVIEW_SUMMARY_MIN_COUNT),
  })
  .nullable();
const cursorSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('distance'), value: z.number(), ...tail }),
  z.object({ mode: z.literal('name'), value: z.string(), ...tail }),
  z.object({
    mode: z.literal('rating-distance'),
    rating: ratingKeySchema,
    value: z.number(),
    ...tail,
  }),
  z.object({ mode: z.literal('rating-name'), rating: ratingKeySchema, value: z.string(), ...tail }),
]);
type Cursor = z.infer<typeof cursorSchema>;
type CursorMode = Cursor['mode'];

const sortOfMode = (mode: CursorMode): SpaceSearchSort =>
  mode === 'rating-distance' || mode === 'rating-name' ? 'rating' : 'distance';

/**
 * Assinatura dos filtros normalizados (raio efetivo, infraestrutura sem repetição e ordenada,
 * nome em minúsculas, como o ILIKE compara, e a nota mínima). O `limit` fica de fora: mudar o
 * tamanho da página não muda a ordem. A ordem (`sort`) vai no modo do cursor. A nota mínima só
 * entra quando vem na query: sem ela, a assinatura é a mesma de antes da decisão 109, e os
 * cursores gerados antes do deploy continuam valendo.
 */
export function filtersSignature(query: SpaceSearchQuery): string {
  const geo = query.lat !== undefined && query.lng !== undefined;
  const normalized: unknown[] = [
    geo ? query.lat : null,
    geo ? query.lng : null,
    geo ? (query.radiusKm ?? SEARCH_DEFAULT_RADIUS_KM) : null,
    query.sport ?? null,
    query.service ?? null,
    [...new Set(query.amenities ?? [])].sort(),
    query.q?.toLowerCase() ?? null,
  ];
  if (query.minRating !== undefined) normalized.push(query.minRating);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('base64url').slice(0, 22);
}

/** Nota pública visível (RF-REVIEW-03): o espaço já está na vitrine em toda busca. */
const hasPublicRating = sql`(${spaces.ratingCount} >= ${REVIEW_SUMMARY_MIN_COUNT}::int)`;

/**
 * A média como o card mostra, vezes 10 (decisão 109): filtro e ordem não contradizem a tela.
 * Inteira, então médias exibidas iguais empatam de verdade e o total desempata.
 */
const ratingTenths = displayedAverageTenths(spaces.ratingSum, spaces.ratingCount);

/**
 * Chaves da ordem `rating`, todas crescentes (média exibida e total negados). Para os "Novo",
 * média e total viram 0: entre eles só a distância (ou o nome) e o id decidem, sem usar a média
 * escondida.
 */
const ratingOrderKeys: SQL[] = [
  sql`(NOT ${hasPublicRating})`,
  sql`(CASE WHEN ${hasPublicRating} THEN -${ratingTenths} ELSE 0 END)`,
  sql`(CASE WHEN ${hasPublicRating} THEN -${spaces.ratingCount} ELSE 0 END)`,
];

/** Valores das chaves de `ratingOrderKeys` para a nota guardada no cursor. */
const ratingCursorValues = (rating: { tenths: number; count: number } | null): SQL[] =>
  rating
    ? [sql`FALSE`, sql`(-(${rating.tenths}::int))`, sql`(-(${rating.count}::int))`]
    : [sql`TRUE`, sql`0`, sql`0`];

const encodeCursor = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');

function decodeCursor(value: string): Cursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw invalidCursor();
  }
}

type CardRow = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  neighborhood: string | null;
  city: string;
  lat: number | null;
  lng: number | null;
  price_per_hour_cents: number;
  distance: number | null;
  rating_count: number;
  rating_sum: number;
  /** A média exibida vezes 10, do banco (a mesma da ordem); nula sem avaliação. */
  rating_tenths: number | null;
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Cursor que continua depois de `last` (último item da página) no modo da busca. */
function cursorAfter(mode: CursorMode, last: CardRow, f: string): Cursor {
  const rating =
    last.rating_count >= REVIEW_SUMMARY_MIN_COUNT && last.rating_tenths !== null
      ? { tenths: last.rating_tenths, count: last.rating_count }
      : null;
  switch (mode) {
    case 'distance':
      return { mode, value: last.distance ?? 0, id: last.id, f };
    case 'name':
      return { mode, value: last.name, id: last.id, f };
    case 'rating-distance':
      return { mode, rating, value: last.distance ?? 0, id: last.id, f };
    case 'rating-name':
      return { mode, rating, value: last.name, id: last.id, f };
  }
}

/** Vitrine, busca, página pública e favoritos (RF-SPACE-05..09, RN-SPACE-01). */
@Injectable()
export class PublicSpacesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly payments: PaymentSettingsService,
  ) {}

  /**
   * Busca na vitrine. Com `lat`/`lng`: só espaços com localização dentro do raio, do mais perto
   * para o mais longe. Sem eles: todos os visíveis, por nome. `minRating` e `sort=rating` usam só
   * a nota pública, pela média como o card mostra (decisão 109). Paginação por cursor (keyset)
   * nas duas ordens.
   */
  async search(query: SpaceSearchQuery): Promise<SpaceSearchResult> {
    const geo = query.lat !== undefined && query.lng !== undefined;
    const point = geo
      ? sql`ST_SetSRID(ST_MakePoint(${query.lng}::float8, ${query.lat}::float8), 4326)::geography`
      : null;
    const distance = point ? sql`ST_Distance(${spaces.location}, ${point})` : sql`NULL::float8`;

    const conditions: SQL[] = [];
    if (point) {
      const radiusM = (query.radiusKm ?? SEARCH_DEFAULT_RADIUS_KM) * 1000;
      conditions.push(sql`ST_DWithin(${spaces.location}, ${point}, ${radiusM}::float8)`);
    }
    if (query.sport) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM ${courts}
        JOIN ${courtSports} ON ${courtSports.courtId} = ${courts.id}
        JOIN ${sports} ON ${sports.id} = ${courtSports.sportId}
        WHERE ${courts.spaceId} = ${spaces.id} AND ${courts.status} = 'ACTIVE'
          AND ${sports.slug} = ${query.sport}
      )`);
    }
    if (query.service && !SERVICES.includes(query.service)) conditions.push(sql`FALSE`);
    if (query.amenities?.length) {
      const slugs = [...new Set(query.amenities)];
      conditions.push(sql`(
        SELECT count(*) FROM ${spaceAmenities}
        JOIN ${amenities} ON ${amenities.id} = ${spaceAmenities.amenityId}
        WHERE ${spaceAmenities.spaceId} = ${spaces.id}
          AND ${amenities.slug} IN (${sql.join(
            slugs.map((slug) => sql`${slug}`),
            sql`, `,
          )})
      ) = ${slugs.length}`);
    }
    if (query.q) {
      conditions.push(sql`${spaces.name} ILIKE ${`%${escapeLike(query.q)}%`}`);
    }
    if (query.minRating !== undefined) {
      // A média exibida (uma casa, como o card) e só com a nota pública: "★ 4,0" entra no
      // `minRating=4`, e os "Novo" saem sem que a média escondida decida nada.
      conditions.push(
        sql`(${hasPublicRating} AND ${ratingTenths} >= ${query.minRating * 10}::int)`,
      );
    }

    const byRating = query.sort === 'rating';
    const mode: CursorMode = byRating
      ? geo
        ? 'rating-distance'
        : 'rating-name'
      : geo
        ? 'distance'
        : 'name';
    // Chaves da ordem, todas crescentes; o id desempata por último. O ORDER BY usa o alias
    // `distance` da coluna calculada; o keyset do cursor (no WHERE, que não enxerga o alias)
    // repete a expressão.
    const keys = (tiebreak: SQL) => [
      ...(byRating ? ratingOrderKeys : []),
      tiebreak,
      sql`${spaces.id}`,
    ];
    const orderKeys = keys(geo ? sql`distance` : sql`${spaces.name}`);
    const cursorKeys = keys(geo ? distance : sql`${spaces.name}`);

    const signature = filtersSignature(query);
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      if (sortOfMode(cursor.mode) !== query.sort) throw cursorSortMismatch();
      if (cursor.mode !== mode || cursor.f !== signature) throw invalidCursor();
      const after = [
        ...('rating' in cursor ? ratingCursorValues(cursor.rating) : []),
        typeof cursor.value === 'number' ? sql`${cursor.value}::float8` : sql`${cursor.value}`,
        sql`${cursor.id}::uuid`,
      ];
      conditions.push(sql`(${sql.join(cursorKeys, sql`, `)}) > (${sql.join(after, sql`, `)})`);
    }

    const rows = await this.cardRows(
      conditions,
      sql.join(orderKeys, sql`, `),
      distance,
      query.limit + 1,
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > query.limit && last ? encodeCursor(cursorAfter(mode, last, signature)) : null;
    return { items: await this.toCards(page), nextCursor };
  }

  private async cardRows(
    conditions: SQL[],
    orderBy: SQL | null,
    distance: SQL = sql`NULL::float8`,
    limit?: number,
  ): Promise<CardRow[]> {
    const where = sql.join([visibleInShowcase, ...conditions], sql` AND `);
    const result = await this.db.execute<CardRow>(sql`
      SELECT ${spaces.id} AS id, ${spaces.slug} AS slug, ${spaces.name} AS name,
        ${spaces.logoUrl} AS logo_url, ${spaces.addressNeighborhood} AS neighborhood, ${cities.name} AS city,
        ST_Y(${spaces.location}::geometry) AS lat, ST_X(${spaces.location}::geometry) AS lng,
        ${spaceSettings.pricePerHourCents} AS price_per_hour_cents,
        ${distance} AS distance,
        ${spaces.ratingCount} AS rating_count, ${spaces.ratingSum} AS rating_sum,
        ${ratingTenths} AS rating_tenths
      FROM ${spaces}
      JOIN ${cities} ON ${cities.id} = ${spaces.cityId}
      JOIN ${spaceSettings} ON ${spaceSettings.spaceId} = ${spaces.id}
      WHERE ${where}
      ${orderBy ? sql`ORDER BY ${orderBy}` : sql``}
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `);
    return result.rows;
  }

  private async toCards(rows: CardRow[]): Promise<SpaceCard[]> {
    const ids = rows.map((row) => row.id);
    const [sportsBySpace, covers] = await Promise.all([
      loadSportsBySpace(this.db, ids),
      loadCovers(this.db, ids),
    ]);
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      logoUrl: row.logo_url,
      neighborhood: row.neighborhood,
      city: row.city,
      location: row.lat === null || row.lng === null ? null : { lat: row.lat, lng: row.lng },
      distanceMeters: row.distance === null ? null : Math.round(row.distance),
      cover: covers.get(row.id) ?? null,
      sports: sportsBySpace.get(row.id) ?? [],
      pricePerHourCents: row.price_per_hour_cents,
      services: SERVICES,
      rating: spaceRating(row.rating_count, row.rating_sum),
    }));
  }

  /** Página pública do espaço (RF-SPACE-08); só espaços visíveis na vitrine. */
  async getBySlug(slug: string): Promise<PublicSpace> {
    const [row] = await this.db
      .select({
        space: spaces,
        city: { id: cities.id, name: cities.name, state: cities.state },
      })
      .from(spaces)
      .innerJoin(cities, eq(cities.id, spaces.cityId))
      .where(and(eq(spaces.slug, slug), visibleInShowcase));
    if (!row) throw spaceNotFound();
    const { space, city } = row;

    const [photos, amenityList, openingHours, settings, courtList, payments] = await Promise.all([
      loadPhotos(this.db, space.id),
      loadAmenities(this.db, space.id),
      loadOpeningHours(this.db, space.id),
      loadSettings(this.db, space.id),
      loadCourts(this.db, space.id, { onlyActive: true }),
      this.payments.publicOptions(space.id),
    ]);
    // `visibleInShowcase` garante o preço.
    const pricePerHourCents = settings.pricePerHourCents ?? 0;

    const sportMap = new Map<string, { slug: string; name: string }>();
    for (const court of courtList) {
      for (const sport of court.sports)
        sportMap.set(sport.slug, { slug: sport.slug, name: sport.name });
    }

    return {
      id: space.id,
      slug: space.slug,
      name: space.name,
      description: space.description,
      address: {
        street: space.addressStreet,
        number: space.addressNumber,
        neighborhood: space.addressNeighborhood,
        postalCode: space.addressPostalCode,
        city,
      },
      location: space.location,
      phone: space.phone,
      whatsapp: space.whatsapp,
      instagram: space.instagram,
      logoUrl: space.logoUrl,
      photos,
      amenities: amenityList,
      openingHours,
      acceptedPaymentMethods: settings.acceptedPaymentMethods,
      sports: [...sportMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      services: SERVICES,
      courts: courtList.map(({ status: _status, ...court }) => court),
      rental: {
        pricePerHourCents,
        minDurationMin: settings.bookingMinDurationMin,
        maxDurationMin: settings.bookingMaxDurationMin,
        minAdvanceMin: settings.bookingMinAdvanceMin,
        windowDays: settings.bookingWindowDays,
        cancellationDeadlineMin: settings.cancellationDeadlineMin,
      },
      ...payments,
      rating: spaceRating(space.ratingCount, space.ratingSum),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Favoritos (RF-SPACE-09)

  /** Favorita (idempotente). Só espaços ACTIVE. */
  async favorite(userId: string, spaceId: string): Promise<void> {
    const [space] = await this.db
      .select({ id: spaces.id })
      .from(spaces)
      .where(and(eq(spaces.id, spaceId), eq(spaces.status, 'ACTIVE')));
    if (!space) throw spaceNotFound();
    await this.db.insert(favorites).values({ userId, spaceId }).onConflictDoNothing();
  }

  /** Desfavorita (idempotente). */
  async unfavorite(userId: string, spaceId: string): Promise<void> {
    await this.db
      .delete(favorites)
      .where(and(eq(favorites.userId, userId), eq(favorites.spaceId, spaceId)));
  }

  /**
   * Cards dos espaços na ordem dos ids, só os que estão na vitrine (RN-SPACE-01), sem distância.
   * Usado pelos anúncios com destino no espaço (RN-ADS-05).
   */
  async cardsByIds(ids: string[]): Promise<SpaceCard[]> {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const rows = await this.cardRows(
      [
        sql`${spaces.id} IN (${sql.join(
          unique.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      ],
      null,
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    return this.toCards(unique.flatMap((id) => byId.get(id) ?? []));
  }

  /**
   * Espaços recentes do usuário (RF-SPACE-12): até 10 espaços da vitrine com reserva (organizador,
   * ou participante que aceitou o convite), aula (presença confirmada, presente ou falta) ou
   * assinatura (não recusada), da interação mais recente para a mais antiga. A interação vale pela
   * data da reserva ou da aula quando ela já passou, e pela data em que foi feita (reserva criada,
   * convite aceito, vaga confirmada) quando ainda vai acontecer; a assinatura vale pela data do
   * pedido. Reservas e aulas canceladas não contam. Sem tabela de visualizações: o que a pessoa
   * só abriu fica no aparelho.
   */
  async recentForUser(userId: string): Promise<SpaceCard[]> {
    const interactionAt = (startsAt: SQL, madeAt: SQL) =>
      sql`CASE WHEN ${startsAt} <= now() THEN ${startsAt} ELSE ${madeAt} END`;
    const { rows } = await this.db.execute<{ space_id: string }>(sql`
      SELECT interactions.space_id
      FROM (
        SELECT ${bookings.spaceId} AS space_id,
          ${interactionAt(sql`${bookings.startsAt}`, sql`${bookings.createdAt}`)} AS at
        FROM ${bookings}
        WHERE ${bookings.organizerUserId} = ${userId} AND ${bookings.status} <> 'CANCELLED'
        UNION ALL
        SELECT ${bookings.spaceId},
          ${interactionAt(sql`${bookings.startsAt}`, sql`${bookingParticipants.updatedAt}`)}
        FROM ${bookingParticipants}
        JOIN ${bookings} ON ${bookings.id} = ${bookingParticipants.bookingId}
        WHERE ${bookingParticipants.userId} = ${userId}
          AND ${bookingParticipants.status} = 'ACCEPTED' AND ${bookings.status} <> 'CANCELLED'
        UNION ALL
        SELECT ${classSessions.spaceId},
          ${interactionAt(sql`${classSessions.startsAt}`, sql`${attendances.createdAt}`)}
        FROM ${attendances}
        JOIN ${classSessions} ON ${classSessions.id} = ${attendances.sessionId}
        WHERE ${attendances.userId} = ${userId}
          AND ${attendances.status} IN ('CONFIRMED', 'PRESENT', 'ABSENT')
          AND ${classSessions.status} <> 'CANCELLED'
        UNION ALL
        SELECT ${subscriptions.spaceId}, ${subscriptions.createdAt}
        FROM ${subscriptions}
        WHERE ${subscriptions.userId} = ${userId} AND ${subscriptions.rejectedAt} IS NULL
      ) interactions
      JOIN ${spaces} ON ${spaces.id} = interactions.space_id
      WHERE ${visibleInShowcase}
      GROUP BY interactions.space_id
      ORDER BY max(interactions.at) DESC, interactions.space_id
      LIMIT ${RECENT_SPACES_LIMIT}
    `);
    return this.cardsByIds(rows.map((row) => row.space_id));
  }

  /**
   * Favoritos do usuário, do mais recente para o mais antigo. Espaços que saíram da vitrine
   * (suspensos, sem quadra ativa ou sem preço) ficam de fora enquanto não voltarem.
   */
  async listFavorites(userId: string): Promise<SpaceCard[]> {
    const favs = await this.db
      .select({ spaceId: favorites.spaceId })
      .from(favorites)
      .where(eq(favorites.userId, userId))
      .orderBy(desc(favorites.createdAt), desc(favorites.id));
    if (!favs.length) return [];
    const rows = await this.cardRows(
      [
        sql`${spaces.id} IN (${sql.join(
          favs.map((fav) => sql`${fav.spaceId}::uuid`),
          sql`, `,
        )})`,
      ],
      null,
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    return this.toCards(favs.flatMap((fav) => byId.get(fav.spaceId) ?? []));
  }
}
