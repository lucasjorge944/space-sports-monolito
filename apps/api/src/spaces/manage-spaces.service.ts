import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CreatePhoto,
  type CreatePhotoUpload,
  MAX_PHOTOS_PER_SPACE,
  type ManagedSpace,
  PHOTO_MAX_BYTES,
  type Photo,
  type PhotoUpload,
  type ReorderPhotos,
  type ReplaceAmenities,
  type ReplaceOpeningHours,
  type SpaceSettings,
  spaceSettingsSchema,
  type UpdateSpace,
  type UpdateSpaceSettings,
} from '@space-sports/shared';
import { and, count, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import {
  amenities,
  cities,
  type GeoPoint,
  spaceAmenities,
  spaceOpeningHours,
  spacePhotos,
  spaceSettings,
  spaces,
} from '../db/schema/index.js';
import { Geocoder } from '../geocoding/geocoder.js';
import { DB } from '../infra/database.module.js';
import { PhotoStorage } from '../storage/photo-storage.js';
import { newPublishedKey, publishedPrefix } from '../storage/uploads.js';
import {
  hasActiveCourt,
  loadAmenities,
  loadOpeningHours,
  loadPhotos,
  loadSettings,
} from './space-queries.js';
import {
  contentTypeOfKey,
  discardPublished,
  isUploadKeyOf,
  lockSpace,
  newUploadKey,
} from './space-uploads.js';
import {
  addressNotFound,
  cityNotFound,
  geocodingUnavailable,
  invalidPhotoFile,
  invalidPhotoKey,
  photoAlreadyAdded,
  photoLimitReached,
  photoNotFound,
  photoNotUploaded,
  photoSetMismatch,
  photoTooLarge,
  spaceNotFound,
  storageUnavailable,
  unknownAmenity,
} from './spaces.errors.js';

type SpaceInsert = typeof spaces.$inferInsert;
/** Escrita extra na mesma transação da edição (a auditoria do Super). */
type InTx = (tx: Tx) => Promise<void>;

/** Gestão do espaço pelo painel (RF-SPACE-01, 02 e 04). O tenant é sempre o `spaceId` da rota. */
@Injectable()
export class ManageSpacesService {
  private readonly logger = new Logger(ManageSpacesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly geocoder: Geocoder,
    private readonly storage: PhotoStorage,
  ) {}

  async get(spaceId: string): Promise<ManagedSpace> {
    const [row] = await this.db
      .select({
        space: spaces,
        city: { id: cities.id, name: cities.name, state: cities.state },
      })
      .from(spaces)
      .innerJoin(cities, eq(cities.id, spaces.cityId))
      .where(eq(spaces.id, spaceId));
    if (!row) throw spaceNotFound();
    const { space, city } = row;

    const [photos, amenityList, openingHours, settings, activeCourt] = await Promise.all([
      loadPhotos(this.db, spaceId),
      loadAmenities(this.db, spaceId),
      loadOpeningHours(this.db, spaceId),
      loadSettings(this.db, spaceId),
      hasActiveCourt(this.db, spaceId),
    ]);
    const missing: ManagedSpace['showcase']['missing'] = [];
    if (space.status !== 'ACTIVE') missing.push('ACTIVE_STATUS');
    if (!activeCourt) missing.push('ACTIVE_COURT');
    if (settings.pricePerHourCents === null) missing.push('PRICE_PER_HOUR');

    return {
      id: space.id,
      name: space.name,
      slug: space.slug,
      description: space.description,
      status: space.status,
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
      showcase: { visible: missing.length === 0, missing },
    };
  }

  /**
   * Atualiza os dados do espaço. Mudar o endereço ou a cidade refaz a geocodificação, a menos que
   * `location` venha no mesmo pedido (pino ajustado à mão). Sem geocoder configurado, o endereço é
   * salvo sem localização.
   *
   * O Super usa `extra` (nome e slug, que o painel não edita) e `inTx` (auditoria), gravados na
   * mesma transação da edição. Validação e geocodificação acontecem antes dela.
   */
  async update(
    spaceId: string,
    patch: UpdateSpace,
    options: { extra?: Partial<Pick<SpaceInsert, 'name' | 'slug'>>; inTx?: InTx } = {},
  ): Promise<ManagedSpace> {
    const [current] = await this.db.select().from(spaces).where(eq(spaces.id, spaceId));
    if (!current) throw spaceNotFound();

    const cityId = patch.cityId ?? current.cityId;
    const [city] = await this.db
      .select({ name: cities.name, state: cities.state, active: cities.active })
      .from(cities)
      .where(eq(cities.id, cityId));
    if (!city || (patch.cityId !== undefined && !city.active)) throw cityNotFound();

    const changes: Partial<SpaceInsert> = { ...options.extra };
    if (patch.description !== undefined) changes.description = patch.description || null;
    if (patch.phone !== undefined) changes.phone = patch.phone;
    if (patch.whatsapp !== undefined) changes.whatsapp = patch.whatsapp;
    if (patch.instagram !== undefined) changes.instagram = patch.instagram;
    if (patch.cityId !== undefined) changes.cityId = patch.cityId;
    if (patch.address !== undefined) {
      changes.addressStreet = patch.address?.street ?? null;
      changes.addressNumber = patch.address?.number ?? null;
      changes.addressNeighborhood = patch.address?.neighborhood ?? null;
      changes.addressPostalCode = patch.address?.postalCode ?? null;
    }

    const addressChanged =
      patch.address !== undefined ||
      (patch.cityId !== undefined && patch.cityId !== current.cityId);
    if (patch.location !== undefined) {
      changes.location = patch.location;
    } else if (addressChanged) {
      const address =
        patch.address === undefined
          ? current.addressStreet &&
            current.addressNumber &&
            current.addressNeighborhood &&
            current.addressPostalCode
            ? {
                street: current.addressStreet,
                number: current.addressNumber,
                neighborhood: current.addressNeighborhood,
                postalCode: current.addressPostalCode,
              }
            : null
          : patch.address;
      changes.location = address
        ? await this.geocode({ ...address, city: city.name, state: city.state })
        : null;
    }

    await this.db.transaction(async (tx) => {
      if (Object.keys(changes).length) {
        await tx.update(spaces).set(changes).where(eq(spaces.id, spaceId));
      }
      await options.inTx?.(tx);
    });
    return this.get(spaceId);
  }

  /** Geocodifica o endereço (nulo sem provedor configurado); erros viram `AppException`. */
  async geocode(address: Parameters<Geocoder['geocode']>[0]): Promise<GeoPoint | null> {
    if (!this.geocoder.enabled) return null;
    let point: GeoPoint | null;
    try {
      point = await this.geocoder.geocode(address);
    } catch (err) {
      this.logger.error({ err }, 'Falha na geocodificação');
      throw geocodingUnavailable();
    }
    if (!point) throw addressNotFound();
    return point;
  }

  /** Substitui a infraestrutura do espaço (RF-SPACE-02). */
  async replaceAmenities(
    spaceId: string,
    { amenityIds }: ReplaceAmenities,
    inTx?: InTx,
  ): Promise<ManagedSpace> {
    const ids = [...new Set(amenityIds)];
    if (ids.length) {
      const found = await this.db
        .select({ id: amenities.id })
        .from(amenities)
        .where(inArray(amenities.id, ids));
      if (found.length !== ids.length) throw unknownAmenity();
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(spaceAmenities).where(eq(spaceAmenities.spaceId, spaceId));
      if (ids.length) {
        await tx.insert(spaceAmenities).values(ids.map((amenityId) => ({ spaceId, amenityId })));
      }
      await inTx?.(tx);
    });
    return this.get(spaceId);
  }

  /** Substitui o horário de funcionamento. */
  async replaceOpeningHours(
    spaceId: string,
    { openingHours }: ReplaceOpeningHours,
    inTx?: InTx,
  ): Promise<ManagedSpace> {
    await this.db.transaction(async (tx) => {
      await tx.delete(spaceOpeningHours).where(eq(spaceOpeningHours.spaceId, spaceId));
      if (openingHours.length) {
        await tx.insert(spaceOpeningHours).values(openingHours.map((h) => ({ spaceId, ...h })));
      }
      await inTx?.(tx);
    });
    return this.get(spaceId);
  }

  // ---------------------------------------------------------------------------------------------
  // Configurações (RF-SPACE-04)

  getSettings(spaceId: string): Promise<SpaceSettings> {
    return loadSettings(this.db, spaceId);
  }

  /**
   * PATCH das configurações: o resultado (salvo + padrões + patch) é validado inteiro, com as
   * regras entre campos, e gravado por completo (os padrões passam a ficar salvos).
   */
  async updateSettings(
    spaceId: string,
    patch: UpdateSpaceSettings,
    inTx?: InTx,
  ): Promise<SpaceSettings> {
    return this.db.transaction(async (tx) => {
      await lockSpace(tx, spaceId);
      const merged = spaceSettingsSchema.parse({ ...(await loadSettings(tx, spaceId)), ...patch });
      await tx
        .insert(spaceSettings)
        .values({ spaceId, ...merged })
        .onConflictDoUpdate({ target: spaceSettings.spaceId, set: merged });
      await inTx?.(tx);
      return merged;
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Fotos: o cliente pede uma URL pré-assinada, envia o arquivo direto ao storage e registra a chave.

  async createPhotoUpload(spaceId: string, input: CreatePhotoUpload): Promise<PhotoUpload> {
    if (!this.storage.enabled) throw storageUnavailable();
    const [row] = await this.db
      .select({ total: count() })
      .from(spacePhotos)
      .where(eq(spacePhotos.spaceId, spaceId));
    if ((row?.total ?? 0) >= MAX_PHOTOS_PER_SPACE) throw photoLimitReached();

    const key = newUploadKey(spaceId, 'photos', input.contentType);
    const upload = await this.storage.presignUpload(key, input.contentType);
    return {
      uploadUrl: upload.url,
      method: 'PUT',
      headers: upload.headers,
      key,
      expiresAt: upload.expiresAt.toISOString(),
    };
  }

  /**
   * Registra a foto já enviada ao storage no fim da galeria (a primeira vira a capa). O arquivo é
   * copiado para uma chave publicada nova (ver `storage/uploads.ts`) e é a cópia que se confere.
   */
  async addPhoto(spaceId: string, input: CreatePhoto): Promise<Photo> {
    if (!this.storage.enabled) throw storageUnavailable();
    if (!isUploadKeyOf(spaceId, 'photos', input.key)) throw invalidPhotoKey();
    // Já há na galeria uma foto deste upload (registro anterior da mesma chave)?
    const prefix = this.storage.publicUrl(publishedPrefix(input.key));
    const alreadyAdded = async (db: Database | Tx) =>
      (await loadPhotos(db, spaceId)).some((photo) => photo.url.startsWith(prefix));
    // Antes de copiar: registrar de novo não pode publicar outra cópia.
    if (await alreadyAdded(this.db)) throw photoAlreadyAdded();

    // Chave publicada nova: nenhum outro pedido nem a URL pré-assinada escrevem nela.
    const target = newPublishedKey(input.key);
    const url = this.storage.publicUrl(target);
    const copied = await this.storage.copy(input.key, target);
    await this.storage.delete(input.key);
    if (!copied) {
      // Outro pedido com a mesma chave já copiou, apagou o upload e gravou a foto.
      throw (await alreadyAdded(this.db)) ? photoAlreadyAdded() : photoNotUploaded();
    }

    try {
      const stored = await this.storage.head(target);
      if (!stored) throw photoNotUploaded();
      // O storage não garante o tamanho nem o tipo declarados no pedido da URL: confere o objeto real
      // e apaga o que não serve, antes de gravar qualquer coisa.
      const invalid =
        stored.size > PHOTO_MAX_BYTES
          ? photoTooLarge()
          : stored.size === 0 || stored.contentType !== contentTypeOfKey(target)
            ? invalidPhotoFile()
            : null;
      if (invalid) throw invalid;
      return await this.insertPhoto(spaceId, url, prefix, input.blurhash ?? null);
    } catch (err) {
      // Esta cópia só fica se a própria URL foi gravada (falha depois do commit).
      await discardPublished(this.db, this.storage, spaceId, target, async (tx) =>
        (await loadPhotos(tx, spaceId)).some((photo) => photo.url === url),
      );
      throw err;
    }
  }

  /** Insere sob o lock do espaço; recusa se outro registro do mesmo upload (`prefix`) já entrou. */
  private insertPhoto(
    spaceId: string,
    url: string,
    prefix: string,
    blurhash: string | null,
  ): Promise<Photo> {
    return this.db.transaction(async (tx) => {
      await lockSpace(tx, spaceId);
      const photos = await loadPhotos(tx, spaceId);
      if (photos.some((photo) => photo.url.startsWith(prefix))) throw photoAlreadyAdded();
      if (photos.length >= MAX_PHOTOS_PER_SPACE) throw photoLimitReached();
      const [photo] = await tx
        .insert(spacePhotos)
        .values({ spaceId, url, blurhash, position: photos.length })
        .returning({
          id: spacePhotos.id,
          url: spacePhotos.url,
          blurhash: spacePhotos.blurhash,
          position: spacePhotos.position,
        });
      if (!photo) throw new Error('Insert da foto sem retorno.');
      return photo;
    });
  }

  /** Nova ordem da galeria (todas as fotos); a primeira é a capa. */
  async reorderPhotos(spaceId: string, { photoIds }: ReorderPhotos): Promise<Photo[]> {
    return this.db.transaction(async (tx) => {
      await lockSpace(tx, spaceId);
      const current = await loadPhotos(tx, spaceId);
      const ids = new Set(photoIds);
      if (
        ids.size !== photoIds.length ||
        ids.size !== current.length ||
        current.some((photo) => !ids.has(photo.id))
      ) {
        throw photoSetMismatch();
      }
      await setPositions(tx, spaceId, photoIds);
      return loadPhotos(tx, spaceId);
    });
  }

  async deletePhoto(spaceId: string, photoId: string): Promise<void> {
    const url = await this.db.transaction(async (tx) => {
      await lockSpace(tx, spaceId);
      const [deleted] = await tx
        .delete(spacePhotos)
        .where(and(eq(spacePhotos.id, photoId), eq(spacePhotos.spaceId, spaceId)))
        .returning({ url: spacePhotos.url });
      if (!deleted) throw photoNotFound();
      const rest = await loadPhotos(tx, spaceId);
      await setPositions(
        tx,
        spaceId,
        rest.map((photo) => photo.id),
      );
      return deleted.url;
    });
    // Depois do commit; se falhar, sobra só o arquivo órfão no bucket.
    const key = this.storage.keyFromUrl(url);
    if (key) await this.storage.delete(key);
  }
}

async function setPositions(tx: Tx, spaceId: string, orderedIds: string[]): Promise<void> {
  for (const [position, id] of orderedIds.entries()) {
    await tx
      .update(spacePhotos)
      .set({ position })
      .where(and(eq(spacePhotos.id, id), eq(spacePhotos.spaceId, spaceId)));
  }
}
