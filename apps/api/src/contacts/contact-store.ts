import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../bookings/db-utils.js';
import { bookingParticipants, contacts, contactTouchpoints, users } from '../db/schema/index.js';
import { normalizeEmail } from '../users/normalize.js';

export type ContactIdentity = {
  name?: string | null | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
};

export type UpsertedContact = {
  id: string;
  /**
   * O convite pode passar para a conta que verificar este e-mail depois. Falso sem e-mail e quando
   * ele já é de uma conta verificada: quem digitou o e-mail dela não prova ser ela.
   */
  viaEmail: boolean;
};

type UpsertOptions = {
  /** Contato que o convite já tinha: recebe o telefone quando só ele foi informado. */
  current?: string | null | undefined;
  marketingConsent?: boolean | undefined;
};

type TouchpointInput = Pick<
  typeof contactTouchpoints.$inferInsert,
  'origin' | 'spaceId' | 'bookingId' | 'capturedBy'
>;

/**
 * Serializa quem mexe no mesmo e-mail ou telefone (os índices únicos são parciais e são dois, o
 * que não combina com ON CONFLICT). As chaves vão em ordem, para duas transações não se travarem.
 */
export async function lockContactIdentities(tx: Tx, identities: ContactIdentity[]): Promise<void> {
  const keys = identities.flatMap(({ email, phone }) => [
    ...(email ? [`contact:email:${normalizeEmail(email)}`] : []),
    ...(phone ? [`contact:phone:${phone}`] : []),
  ]);
  for (const key of [...new Set(keys)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }
}

/** Conta dona do e-mail verificado: o contato com esse e-mail já nasce vinculado a ela. */
async function verifiedAccountId(tx: Tx, email: string): Promise<string | null> {
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), eq(users.emailVerified, true), isNull(users.deletedAt)));
  return user?.id ?? null;
}

const contactWhere = (tx: Tx, where: ReturnType<typeof eq>) =>
  tx.select().from(contacts).where(where);

/**
 * Acha ou cria o contato (RF-CONTACT-01). Tudo aqui é digitado por terceiros, sem verificação, e
 * `users` só confia no e-mail: por isso **e-mail nunca entra em contato que já existe**. Se
 * entrasse, quem digitasse o próprio e-mail junto com o telefone de outra pessoa levaria, ao
 * verificar a conta, os convites dela. Com e-mail, a chave é sempre o e-mail; sem ele, o telefone.
 * Dado que falta é completado (nome, telefone livre, consentimento); dado existente não muda, e
 * o descadastro nunca é desfeito por formulário público.
 *
 * Chamar com as identidades já travadas (`lockContactIdentities`).
 */
export async function upsertContact(
  tx: Tx,
  identity: ContactIdentity,
  { current, marketingConsent = false }: UpsertOptions = {},
): Promise<UpsertedContact> {
  const email = identity.email ? normalizeEmail(identity.email) : null;
  const phone = identity.phone ?? null;
  const name = identity.name ?? null;
  const [byEmail] = email ? await contactWhere(tx, eq(contacts.email, email)) : [];
  const [byPhone] = phone ? await contactWhere(tx, eq(contacts.phone, phone)) : [];
  const [existing] = current && !byPhone ? await contactWhere(tx, eq(contacts.id, current)) : [];

  const target = email ? byEmail : (byPhone ?? (existing?.phone ? undefined : existing));
  const consentAt = marketingConsent ? new Date() : null;
  const freePhone = byPhone ? null : phone;
  const userId = email ? await verifiedAccountId(tx, email) : null;
  const viaEmail = Boolean(email) && !userId;

  if (!target) {
    const [created] = await tx
      .insert(contacts)
      .values({ name, email, phone: freePhone, userId, marketingConsentAt: consentAt })
      .returning({ id: contacts.id });
    if (!created) throw new Error('Insert de contato sem retorno.');
    return { id: created.id, viaEmail };
  }

  const patch = {
    name: target.name ?? name,
    phone: target.phone ?? freePhone,
    userId: target.userId ?? userId,
    marketingConsentAt: target.marketingConsentAt ?? consentAt,
  };
  const changed = (Object.keys(patch) as (keyof typeof patch)[]).some(
    (key) => patch[key] !== target[key],
  );
  if (changed) await tx.update(contacts).set(patch).where(eq(contacts.id, target.id));
  return { id: target.id, viaEmail };
}

/** Grava (ou completa) o contato e registra a passagem pelo espaço, com o que foi informado ali. */
export async function captureContact(
  tx: Tx,
  identity: ContactIdentity,
  touchpoint: TouchpointInput,
  options: UpsertOptions = {},
): Promise<UpsertedContact> {
  await lockContactIdentities(tx, [identity]);
  const contact = await upsertContact(tx, identity, options);
  await tx.insert(contactTouchpoints).values({
    ...touchpoint,
    contactId: contact.id,
    name: identity.name ?? null,
    email: identity.email ? normalizeEmail(identity.email) : null,
    phone: identity.phone ?? null,
    marketingConsentAt: options.marketingConsent ? new Date() : null,
  });
  return contact;
}

/**
 * A identidade é a de quem está no convite? Basta o mesmo telefone ou e-mail do contato, ou do que
 * a pessoa informou ao confirmar: o touchpoint guarda o que não entrou em `contacts`
 * (RN-CONTACT-02). O que o organizador digitou não conta, porque não veio de quem confirmou.
 */
export async function matchesInviteContact(
  db: DbOrTx,
  { contactId, bookingId }: { contactId: string | null; bookingId: string },
  identity: ContactIdentity,
): Promise<boolean> {
  if (!contactId) return false;
  const email = identity.email ? normalizeEmail(identity.email) : null;
  const phone = identity.phone ?? null;
  const known = { email: contacts.email, phone: contacts.phone };
  const [contact] = await db.select(known).from(contacts).where(eq(contacts.id, contactId));
  const informed = await db
    .select({ email: contactTouchpoints.email, phone: contactTouchpoints.phone })
    .from(contactTouchpoints)
    .where(
      and(
        eq(contactTouchpoints.contactId, contactId),
        eq(contactTouchpoints.bookingId, bookingId),
        eq(contactTouchpoints.origin, 'BOOKING_INVITE_SELF'),
      ),
    );
  return [contact, ...informed].some(
    (row) => (email && row?.email === email) || (phone && row?.phone === phone),
  );
}

/** Vincula o contato sem dono. O dono só muda pelo e-mail verificado (`ContactLinksService`). */
export async function linkContactToUser(
  db: DbOrTx,
  contactId: string,
  userId: string,
): Promise<void> {
  await db
    .update(contacts)
    .set({ userId })
    .where(and(eq(contacts.id, contactId), isNull(contacts.userId)));
}

/**
 * Telefone informado nesta reserva, por contato. A sugestão de conta parte só dele: o telefone
 * global do contato pode ter vindo de outro espaço.
 */
export async function phonesInformedInBooking(
  db: DbOrTx,
  bookingId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ contactId: contactTouchpoints.contactId, phone: contactTouchpoints.phone })
    .from(contactTouchpoints)
    .where(and(eq(contactTouchpoints.bookingId, bookingId), isNotNull(contactTouchpoints.phone)))
    .orderBy(asc(contactTouchpoints.createdAt), asc(contactTouchpoints.id));
  return new Map(rows.flatMap(({ contactId, phone }) => (phone ? [[contactId, phone]] : [])));
}

/** Contas ativas com estes telefones. O telefone da conta só entra verificado, pelo OTP. */
export async function accountsByPhone(
  db: DbOrTx,
  phones: string[],
): Promise<{ id: string; name: string; phone: string }[]> {
  if (!phones.length) return [];
  const rows = await db
    .select({ id: users.id, name: users.name, phone: users.phone })
    .from(users)
    .where(
      and(
        inArray(users.phone, phones),
        eq(users.phoneVerified, true),
        eq(users.status, 'ACTIVE'),
        isNull(users.deletedAt),
      ),
    );
  return rows.flatMap((row) => (row.phone ? [{ ...row, phone: row.phone }] : []));
}

/**
 * Apaga contatos e touchpoints (decisão 48). O nome digitado no convite sai junto; a reserva e a
 * parte do participante ficam no histórico do espaço, sem o vínculo.
 */
export async function deleteContacts(db: DbOrTx, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db
    .update(bookingParticipants)
    .set({ name: null })
    .where(inArray(bookingParticipants.contactId, ids));
  await db.delete(contacts).where(inArray(contacts.id, ids));
}

/**
 * Exclusão de conta: apaga os contatos vinculados e os que têm o e-mail ou o telefone verificados
 * dela, além dos touchpoints de outros contatos que guardam esse e-mail ou telefone. Dado sem
 * verificação não conta: senão, uma conta com o e-mail de outra pessoa apagaria o contato dela.
 */
export async function deleteUserContacts(
  tx: Tx,
  user: {
    id: string;
    email: string | null;
    emailVerified: boolean;
    phone: string | null;
    phoneVerified: boolean;
  },
): Promise<void> {
  const rows = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      or(
        eq(contacts.userId, user.id),
        user.email && user.emailVerified ? eq(contacts.email, user.email) : undefined,
        user.phone && user.phoneVerified ? eq(contacts.phone, user.phone) : undefined,
      ),
    );
  await deleteContacts(
    tx,
    rows.map((row) => row.id),
  );
  const email = user.email && user.emailVerified ? user.email : null;
  const phone = user.phone && user.phoneVerified ? user.phone : null;
  if (email || phone) {
    await tx
      .delete(contactTouchpoints)
      .where(
        or(
          email ? eq(contactTouchpoints.email, email) : undefined,
          phone ? eq(contactTouchpoints.phone, phone) : undefined,
        ),
      );
  }
}
