import { Inject, Injectable } from '@nestjs/common';
import {
  type ContactOrigin,
  type ContactPage,
  type ContactsExportQuery,
  type ContactsQuery,
  DEFAULT_TIME_ZONE,
  type SuperContactPage,
  type SuperContactsExportQuery,
  type SuperContactsQuery,
  type UnsubscribeResult,
} from '@space-sports/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  max,
  min,
  not,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { audit } from '../bookings/db-utils.js';
import { CSV_BOM, csvLine, csvLocalDateTime } from '../common/csv.js';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import type { Database } from '../db/client.js';
import { cities, contacts, contactTouchpoints, spaces } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { likePattern, superAudit } from '../super/super-audit.js';
import { deleteContacts } from './contact-store.js';
import { contactNotFound, unsubscribeTokenInvalid } from './contacts.errors.js';
import { unsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token.js';

type ContactRow = typeof contacts.$inferSelect;
type SpaceData = Awaited<ReturnType<ContactsService['spaceData']>>[number];
type CsvContact = {
  name: string | null;
  email: string | null;
  phone: string | null;
  consentAt: Date | null;
  origins: string[];
  lastTouchAt: Date | null;
};

const CSV_BATCH = 1000;
export const CONTACT_CSV_COLUMNS = [
  'nome',
  'email',
  'telefone',
  'consentimento_em',
  'origens',
  'ultimo_contato_em',
  'link_descadastro',
] as const;

/** Consentimento vigente na base: é o que libera a exportação do Super. */
const consented = and(
  isNotNull(contacts.marketingConsentAt),
  isNull(contacts.unsubscribedAt),
) as SQL;

/** Valor mais recente de um campo do touchpoint, ignorando quem não o informou. */
const latest = (column: AnyPgColumn) =>
  sql<
    string | null
  >`(array_agg(${column} ORDER BY ${contactTouchpoints.createdAt} DESC, ${contactTouchpoints.id} DESC) FILTER (WHERE ${column} IS NOT NULL))[1]`;

const iso = (date: Date | null | undefined) => date?.toISOString() ?? null;

function toSpaceFields(data: SpaceData) {
  return {
    name: data.name,
    email: data.email,
    phone: data.phone,
    marketingConsentAt: iso(data.marketingConsentAt),
    origins: data.origins as ContactOrigin[],
    firstTouchAt: (data.firstTouchAt as Date).toISOString(),
    lastTouchAt: (data.lastTouchAt as Date).toISOString(),
  };
}

/**
 * Consulta da base de contatos (RF-CONTACT-06, RF-CONTACT-07). `contacts` é global e só o Super o
 * lê. A gestão vê apenas o que foi informado no espaço da rota, a partir dos touchpoints dele, na
 * lista, nos filtros, na busca e na exportação, que exige consentimento dado ali.
 */
@Injectable()
export class ContactsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async listForSuper(query: SuperContactsQuery): Promise<SuperContactPage> {
    const { rows, total } = await this.page(query, this.superConditions(query));
    const data = await this.spaceData(rows.map((row) => row.id));
    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        userId: row.userId,
        marketingConsentAt: iso(row.marketingConsentAt),
        unsubscribedAt: iso(row.unsubscribedAt),
        createdAt: row.createdAt.toISOString(),
        spaces: data
          .filter((item) => item.contactId === row.id)
          .map((item) => ({
            spaceId: item.spaceId,
            spaceName: item.spaceName,
            ...toSpaceFields(item),
          })),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async listForSpace(spaceId: string, query: ContactsQuery): Promise<ContactPage> {
    const { rows, total } = await this.page(query, this.spaceConditions(spaceId, query));
    const data = await this.spaceDataById(
      rows.map((row) => row.id),
      spaceId,
    );
    return {
      items: rows.flatMap((row) => {
        const item = data.get(row.id);
        if (!item) return [];
        return [
          {
            id: row.id,
            ...toSpaceFields(item),
            unsubscribedAt: item.marketingConsentAt ? iso(row.unsubscribedAt) : null,
          },
        ];
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** RF-CONTACT-08: apagar a pedido do titular. A auditoria guarda só o id. */
  async remove(actorId: string, contactId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [contact] = await tx
        .select({ id: contacts.id, userId: contacts.userId })
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .for('update');
      if (!contact) throw contactNotFound();
      await deleteContacts(tx, [contact.id]);
      await superAudit(tx, actorId, {
        action: 'super.contact.delete',
        entity: 'contact',
        entityId: contact.id,
        diff: { userId: contact.userId },
      });
    });
  }

  /** Quem exportou e com quais filtros fica registrado antes do download, como no financeiro. */
  async auditSuperExport(actorId: string, filters: SuperContactsExportQuery): Promise<void> {
    await superAudit(this.db, actorId, {
      action: 'super.contact.export_csv',
      entity: 'contact',
      entityId: null,
      spaceId: filters.spaceId ?? null,
      diff: { filters },
    });
  }

  async auditSpaceExport(
    actorId: string,
    spaceId: string,
    filters: ContactsExportQuery,
  ): Promise<void> {
    await audit(this.db, {
      actorId,
      spaceId,
      action: 'contact.export_csv',
      entity: 'contact',
      entityId: null,
      diff: { filters },
    });
  }

  /** A base inteira, com os dados globais e o consentimento em qualquer espaço. */
  exportForSuper(filters: SuperContactsExportQuery): AsyncGenerator<string> {
    return this.exportCsv(
      and(this.superConditions(filters), consented),
      DEFAULT_TIME_ZONE,
      async (rows) => {
        const data = await this.spaceData(rows.map((row) => row.id));
        return (row) => {
          const own = data.filter((item) => item.contactId === row.id);
          const touches = own.flatMap((item) => (item.lastTouchAt ? [item.lastTouchAt] : []));
          return {
            name: row.name,
            email: row.email,
            phone: row.phone,
            consentAt: row.marketingConsentAt,
            origins: [...new Set(own.flatMap((item) => item.origins))],
            lastTouchAt: touches.sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
          };
        };
      },
    );
  }

  /** Só o que foi informado no espaço, e só de quem deu consentimento ali. */
  async *exportForSpace(spaceId: string, filters: ContactsExportQuery): AsyncGenerator<string> {
    const [space] = await this.db
      .select({ timeZone: cities.timezone })
      .from(spaces)
      .innerJoin(cities, eq(cities.id, spaces.cityId))
      .where(eq(spaces.id, spaceId));
    yield* this.exportCsv(
      and(this.spaceConditions(spaceId, filters), this.consentedIn(spaceId)),
      space?.timeZone || DEFAULT_TIME_ZONE,
      async (rows) => {
        const data = await this.spaceDataById(
          rows.map((row) => row.id),
          spaceId,
        );
        return (row) => {
          const item = data.get(row.id);
          return {
            name: item?.name ?? null,
            email: item?.email ?? null,
            phone: item?.phone ?? null,
            consentAt: item?.marketingConsentAt ?? null,
            origins: item?.origins ?? [],
            lastTouchAt: item?.lastTouchAt ?? null,
          };
        };
      },
    );
  }

  /** RF-CONTACT-08: idempotente, e o contato apagado responde igual ao descadastrado. */
  async unsubscribe(token: string): Promise<UnsubscribeResult> {
    const contactId = verifyUnsubscribeToken(this.env.BETTER_AUTH_SECRET, token);
    if (!contactId) throw unsubscribeTokenInvalid();
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(contacts)
        .set({ unsubscribedAt: new Date() })
        .where(and(eq(contacts.id, contactId), isNull(contacts.unsubscribedAt)))
        .returning({ id: contacts.id });
      if (updated) {
        await audit(tx, {
          actorId: null,
          spaceId: null,
          action: 'contact.unsubscribe',
          entity: 'contact',
          entityId: updated.id,
        });
      }
    });
    return { unsubscribed: true };
  }

  private async page(
    { page, pageSize }: { page: number; pageSize: number },
    where: SQL | undefined,
  ) {
    const [totalRow] = await this.db.select({ total: count() }).from(contacts).where(where);
    const rows = await this.db
      .select()
      .from(contacts)
      .where(where)
      .orderBy(desc(contacts.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return { rows, total: totalRow?.total ?? 0 };
  }

  /** Existe touchpoint do contato com estas condições. */
  private touched(...conditions: (SQL | undefined)[]): SQL {
    return exists(
      this.db
        .select({ one: sql`1` })
        .from(contactTouchpoints)
        .where(and(eq(contactTouchpoints.contactId, contacts.id), ...conditions)),
    );
  }

  /** Consentimento dado no espaço e sem descadastro: o descadastro vale para todos. */
  private consentedIn(spaceId: string): SQL {
    return and(
      this.touched(
        eq(contactTouchpoints.spaceId, spaceId),
        isNotNull(contactTouchpoints.marketingConsentAt),
      ),
      isNull(contacts.unsubscribedAt),
    ) as SQL;
  }

  private spaceConditions(
    spaceId: string,
    { q, consent, origin }: ContactsExportQuery,
  ): SQL | undefined {
    const here = eq(contactTouchpoints.spaceId, spaceId);
    const pattern = q ? likePattern(q) : undefined;
    return and(
      this.touched(here),
      origin ? this.touched(here, eq(contactTouchpoints.origin, origin)) : undefined,
      pattern
        ? this.touched(
            here,
            or(
              ilike(contactTouchpoints.name, pattern),
              ilike(contactTouchpoints.email, pattern),
              ilike(contactTouchpoints.phone, pattern),
            ),
          )
        : undefined,
      consent === undefined
        ? undefined
        : consent
          ? this.consentedIn(spaceId)
          : not(this.consentedIn(spaceId)),
    );
  }

  private superConditions({
    q,
    consent,
    hasAccount,
    origin,
    spaceId,
  }: SuperContactsExportQuery): SQL | undefined {
    const pattern = q ? likePattern(q) : undefined;
    return and(
      pattern
        ? or(
            ilike(contacts.name, pattern),
            ilike(contacts.email, pattern),
            ilike(contacts.phone, pattern),
          )
        : undefined,
      consent === undefined ? undefined : consent ? consented : not(consented),
      hasAccount === undefined
        ? undefined
        : hasAccount
          ? isNotNull(contacts.userId)
          : isNull(contacts.userId),
      // Espaço e origem valem para o mesmo touchpoint.
      spaceId || origin
        ? this.touched(
            spaceId ? eq(contactTouchpoints.spaceId, spaceId) : undefined,
            origin ? eq(contactTouchpoints.origin, origin) : undefined,
          )
        : undefined,
    );
  }

  /** O que cada contato informou em cada espaço; com `spaceId`, só naquele espaço. */
  private async spaceData(ids: string[], spaceId?: string) {
    if (!ids.length) return [];
    return this.db
      .select({
        contactId: contactTouchpoints.contactId,
        spaceId: contactTouchpoints.spaceId,
        spaceName: spaces.name,
        name: latest(contactTouchpoints.name),
        email: latest(contactTouchpoints.email),
        phone: latest(contactTouchpoints.phone),
        marketingConsentAt: max(contactTouchpoints.marketingConsentAt),
        origins: sql<string[]>`array_agg(DISTINCT ${contactTouchpoints.origin}::text)`,
        firstTouchAt: min(contactTouchpoints.createdAt),
        lastTouchAt: max(contactTouchpoints.createdAt),
      })
      .from(contactTouchpoints)
      .innerJoin(spaces, eq(spaces.id, contactTouchpoints.spaceId))
      .where(
        and(
          inArray(contactTouchpoints.contactId, ids),
          spaceId ? eq(contactTouchpoints.spaceId, spaceId) : undefined,
        ),
      )
      .groupBy(contactTouchpoints.contactId, contactTouchpoints.spaceId, spaces.name)
      .orderBy(asc(spaces.name));
  }

  private async spaceDataById(ids: string[], spaceId: string) {
    const rows = await this.spaceData(ids, spaceId);
    return new Map(rows.map((row) => [row.contactId, row]));
  }

  /**
   * Um contato por linha, em lotes por id, em UTF-8 com BOM. `link_descadastro` vai em cada linha
   * porque toda comunicação feita com a lista precisa oferecer a saída. `prepare` carrega o lote e
   * devolve o que cada visão mostra de um contato.
   */
  private async *exportCsv(
    where: SQL | undefined,
    timeZone: string,
    prepare: (rows: ContactRow[]) => Promise<(row: ContactRow) => CsvContact>,
  ): AsyncGenerator<string> {
    yield `${CSV_BOM}${CONTACT_CSV_COLUMNS.join(',')}\r\n`;

    let lastId: string | null = null;
    for (;;) {
      const rows: ContactRow[] = await this.db
        .select()
        .from(contacts)
        .where(and(where, lastId ? gt(contacts.id, lastId) : undefined))
        .orderBy(asc(contacts.id))
        .limit(CSV_BATCH);
      if (!rows.length) return;
      const view = await prepare(rows);
      yield rows
        .map((row) => {
          const contact = view(row);
          const token = unsubscribeToken(this.env.BETTER_AUTH_SECRET, row.id);
          return csvLine([
            contact.name ?? '',
            contact.email ?? '',
            contact.phone ?? '',
            contact.consentAt ? csvLocalDateTime(contact.consentAt, timeZone) : '',
            contact.origins.join(' '),
            contact.lastTouchAt ? csvLocalDateTime(contact.lastTouchAt, timeZone) : '',
            `${this.env.WEB_URL}/descadastro/${token}`,
          ]);
        })
        .join('');
      lastId = rows[rows.length - 1]?.id ?? null;
      if (rows.length < CSV_BATCH) return;
    }
  }
}
