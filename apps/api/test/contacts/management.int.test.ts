import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  bookingParticipants,
  contacts,
  contactTouchpoints,
} from '../../src/db/schema/index.js';
import {
  createTestApp,
  makeSuper,
  PASSWORD,
  type SignedUp,
  signUp,
  type TestApp,
  WEB_ORIGIN,
} from '../auth/helpers.js';
import {
  bearer,
  createSpace,
  member,
  type Space,
  slotIn,
  useMiddayClock,
} from '../bookings/fixtures.js';
import { book, confirmPublic, invite, tokenOf, verifyEmail, verifyPhone } from './helpers.js';

useMiddayClock();

type SpaceData = {
  name: string | null;
  email: string | null;
  phone: string | null;
  marketingConsentAt: string | null;
  origins: string[];
};

type Row = SpaceData & {
  id: string;
  unsubscribedAt: string | null;
  spaces?: (SpaceData & { spaceId: string; spaceName: string })[];
};

const csvRows = (text: string) => text.slice(1).trimEnd().split('\r\n');

describe('gestão dos contatos (RF-CONTACT-06 a RF-CONTACT-08)', () => {
  let t: TestApp;
  let spaceA: Space;
  let spaceB: Space;
  let organizer: SignedUp;
  let ownerA: SignedUp;
  let adminB: SignedUp;
  let teacherA: SignedUp;
  let superUser: SignedUp;
  let hours = 24;
  const nextHours = () => {
    hours += 2;
    return hours;
  };

  /** Convidado que confirmou na página pública do espaço. */
  const guestIn = async (
    space: Space,
    body: { name: string; phone?: string; email?: string; marketingConsent?: boolean },
  ) => {
    const booking = await book(t, organizer, space, nextHours());
    const detail = await invite(t, organizer, booking.id, { items: [{}] });
    await confirmPublic(t, tokenOf(detail), body).expect(200);
    return booking;
  };

  const superList = async (query = '') =>
    (
      await t
        .http()
        .get(`/v1/super/contacts${query}`)
        .set(...bearer(superUser))
        .expect(200)
    ).body as { items: Row[]; page: number; pageSize: number; total: number };
  const spaceList = async (space: Space, user: SignedUp, query = '') =>
    (
      await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/contacts${query}`)
        .set(...bearer(user))
        .expect(200)
    ).body as { items: Row[]; total: number };
  const superExport = (query = '') =>
    t
      .http()
      .get(`/v1/super/contacts/export.csv${query}`)
      .set(...bearer(superUser));
  const spaceExport = (space: Space, user: SignedUp) =>
    t
      .http()
      .get(`/v1/manage/spaces/${space.id}/contacts/export.csv`)
      .set(...bearer(user));
  const names = (items: Row[]) => items.map((row) => row.name).sort();

  beforeAll(async () => {
    t = await createTestApp();
    spaceA = await createSpace(t.db, 'arena-a');
    spaceB = await createSpace(t.db, 'arena-b');
    organizer = await signUp(t, 'organizadora@exemplo.com', 'Organizadora');
    ownerA = await member(t, 'dona-a@exemplo.com', spaceA.id, 'OWNER');
    adminB = await member(t, 'admin-b@exemplo.com', spaceB.id, 'ADMIN');
    teacherA = await member(t, 'professor-a@exemplo.com', spaceA.id, 'TEACHER');
    superUser = await signUp(t, 'super@exemplo.com', 'Super');
    await makeSuper(t.db, superUser.id);

    await guestIn(spaceA, {
      name: 'Com Consentimento A',
      phone: '+5531944440001',
      marketingConsent: true,
    });
    await guestIn(spaceA, { name: 'Sem Consentimento A', phone: '+5531944440002' });
    await guestIn(spaceB, {
      name: 'Com Consentimento B',
      email: 'b@exemplo.com',
      marketingConsent: true,
    });
    // Passou pelos dois espaços.
    await guestIn(spaceA, { name: 'Nos Dois', phone: '+5531944440003' });
    await guestIn(spaceB, { name: 'Nos Dois', phone: '+5531944440003' });
  });
  afterAll(() => t.close());

  describe('espaço', () => {
    it('vê só quem tem touchpoint nele, com as origens dele', async () => {
      const a = await spaceList(spaceA, ownerA);
      expect(names(a.items)).toEqual(['Com Consentimento A', 'Nos Dois', 'Sem Consentimento A']);
      const b = await spaceList(spaceB, adminB);
      expect(names(b.items)).toEqual(['Com Consentimento B', 'Nos Dois']);
    });

    it('não recebe touchpoints nem origens de outro espaço', async () => {
      const booking = await book(t, organizer, spaceB, nextHours());
      await invite(t, organizer, booking.id, { items: [{ phone: '+5531944440003' }] });
      const a = await spaceList(spaceA, ownerA);
      const shared = a.items.find((row) => row.name === 'Nos Dois');
      expect(shared?.origins).toEqual(['BOOKING_INVITE_SELF']);
      for (const field of ['spaces', 'userId', 'hasAccount', 'createdAt']) {
        expect(shared).not.toHaveProperty(field);
      }
    });

    it('recusa quem não é Dono ou Admin, e Dono de outro espaço', async () => {
      await t
        .http()
        .get(`/v1/manage/spaces/${spaceA.id}/contacts`)
        .set(...bearer(teacherA))
        .expect(403);
      await t
        .http()
        .get(`/v1/manage/spaces/${spaceA.id}/contacts`)
        .set(...bearer(adminB))
        .expect(403);
      await spaceExport(spaceA, teacherA).expect(403);
      await spaceExport(spaceA, adminB).expect(403);
    });

    it('filtros não passam por cima do espaço', async () => {
      const found = await spaceList(spaceA, ownerA, '?q=Consentimento%20B');
      expect(found.items).toEqual([]);
      const consent = await spaceList(spaceA, ownerA, '?consent=true');
      expect(names(consent.items)).toEqual(['Com Consentimento A']);
    });

    it('exporta só quem deu consentimento e passou pelo espaço, e audita', async () => {
      const res = await spaceExport(spaceA, ownerA).expect(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toBe('attachment; filename="contatos.csv"');
      const lines = csvRows(res.text);
      expect(lines[0]).toBe(
        'nome,email,telefone,consentimento_em,origens,ultimo_contato_em,link_descadastro',
      );
      expect(lines).toHaveLength(2);
      const row = lines[1]?.split(',') ?? [];
      expect(row.slice(0, 3)).toEqual(['Com Consentimento A', '', '+5531944440001']);
      expect(row[3]).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
      expect(row[4]).toBe('BOOKING_INVITE_SELF');
      expect(row[6]).toContain(`${WEB_ORIGIN}/descadastro/`);
      expect(res.text).not.toContain('Sem Consentimento');
      expect(res.text).not.toContain('Consentimento B');

      const [log] = await t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'contact.export_csv'), eq(auditLogs.actorId, ownerA.id)));
      expect(log).toMatchObject({ spaceId: spaceA.id, entity: 'contact', actingAsSuper: false });
    });
  });

  describe('Super', () => {
    it('vê a base inteira, paginada, com os espaços de cada contato', async () => {
      const all = await superList();
      expect(all.total).toBe(4);
      expect(all.items.find((row) => row.name === 'Nos Dois')?.spaces).toHaveLength(2);
      const page = await superList('?pageSize=1&page=2');
      expect(page).toMatchObject({ page: 2, pageSize: 1, total: 4 });
      expect(page.items).toHaveLength(1);
    });

    it('filtra por consentimento, conta, origem, espaço e busca', async () => {
      expect(names((await superList('?consent=true')).items)).toEqual([
        'Com Consentimento A',
        'Com Consentimento B',
      ]);
      expect(names((await superList('?consent=false')).items)).toEqual([
        'Nos Dois',
        'Sem Consentimento A',
      ]);
      expect((await superList('?hasAccount=true')).total).toBe(0);
      expect((await superList('?hasAccount=false')).total).toBe(4);
      expect((await superList('?origin=DESK_BOOKING')).total).toBe(0);
      expect((await superList('?origin=BOOKING_INVITE_SELF')).total).toBe(4);
      expect(names((await superList(`?spaceId=${spaceB.id}`)).items)).toEqual([
        'Com Consentimento B',
        'Nos Dois',
      ]);
      expect(names((await superList('?q=b@exemplo')).items)).toEqual(['Com Consentimento B']);
      expect(names((await superList('?q=44440002')).items)).toEqual(['Sem Consentimento A']);
    });

    it('recusa quem não é Super', async () => {
      await t
        .http()
        .get('/v1/super/contacts')
        .set(...bearer(ownerA))
        .expect(403);
      await t
        .http()
        .get('/v1/super/contacts/export.csv')
        .set(...bearer(ownerA))
        .expect(403);
    });

    it('exporta só quem deu consentimento, mesmo pedindo o contrário, e audita', async () => {
      const res = await superExport().expect(200);
      const lines = csvRows(res.text);
      expect(lines).toHaveLength(3);
      expect(res.text).not.toContain('Sem Consentimento');
      expect(res.text).not.toContain('Nos Dois');
      expect(csvRows((await superExport('?consent=false').expect(200)).text)).toHaveLength(1);

      const filtered = await superExport(`?spaceId=${spaceA.id}`).expect(200);
      expect(csvRows(filtered.text)).toHaveLength(2);

      const logs = await t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'super.contact.export_csv'));
      expect(logs.length).toBeGreaterThanOrEqual(3);
      expect(logs[0]).toMatchObject({ actorId: superUser.id, actingAsSuper: true });
    });
  });

  describe('descadastro', () => {
    const unsubscribe = (token: string) =>
      t.http().post('/v1/public/contacts/unsubscribe').send({ token });

    it('o link da exportação tira o contato das próximas exportações; repetir não dá erro', async () => {
      await guestIn(spaceA, {
        name: 'Vai Sair',
        email: 'sair@exemplo.com',
        marketingConsent: true,
      });
      const res = await superExport('?q=sair@exemplo').expect(200);
      const link = csvRows(res.text)[1]?.split(',')[6] ?? '';
      const token = link.split('/descadastro/')[1] ?? '';

      expect((await unsubscribe(token).expect(200)).body).toEqual({ unsubscribed: true });
      await unsubscribe(token).expect(200);

      expect(csvRows((await superExport('?q=sair@exemplo').expect(200)).text)).toHaveLength(1);
      const [contact] = await t.db
        .select()
        .from(contacts)
        .where(eq(contacts.email, 'sair@exemplo.com'));
      expect(contact?.unsubscribedAt).toBeInstanceOf(Date);
      expect(names((await superList('?q=sair@exemplo&consent=false')).items)).toEqual(['Vai Sair']);
      const logs = await t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'contact.unsubscribe'));
      expect(logs).toHaveLength(1);
    });

    it('formulário público não desfaz o descadastro', async () => {
      await guestIn(spaceA, {
        name: 'Vai Sair',
        email: 'sair@exemplo.com',
        marketingConsent: true,
      });
      expect(csvRows((await superExport('?q=sair@exemplo').expect(200)).text)).toHaveLength(1);
    });

    it('token adulterado é recusado', async () => {
      const res = await unsubscribe('018f0000-0000-7000-8000-000000000000.falso').expect(422);
      expect(res.body.error.code).toBe('UNSUBSCRIBE_TOKEN_INVALID');
    });
  });

  it('Super apaga o contato com touchpoints e nome, e o participante fica sem vínculo', async () => {
    await guestIn(spaceA, { name: 'Apagar Agora', phone: '+5531944440009' });
    const [contact] = await t.db
      .select()
      .from(contacts)
      .where(eq(contacts.phone, '+5531944440009'));
    const id = contact?.id ?? '';

    await t
      .http()
      .delete(`/v1/super/contacts/${id}`)
      .set(...bearer(ownerA))
      .expect(403);
    await t
      .http()
      .delete(`/v1/super/contacts/${id}`)
      .set(...bearer(superUser))
      .expect(204);
    await t
      .http()
      .delete(`/v1/super/contacts/${id}`)
      .set(...bearer(superUser))
      .expect(404);

    expect(await t.db.select().from(contacts).where(eq(contacts.id, id))).toEqual([]);
    expect(
      await t.db.select().from(contactTouchpoints).where(eq(contactTouchpoints.contactId, id)),
    ).toEqual([]);
    const orphans = await t.db
      .select()
      .from(bookingParticipants)
      .where(eq(bookingParticipants.name, 'Apagar Agora'));
    expect(orphans).toEqual([]);
    const [log] = await t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'super.contact.delete'));
    expect(log).toMatchObject({ entityId: id, actorId: superUser.id });
    expect(JSON.stringify(log?.diff)).not.toContain('Apagar Agora');
  });

  describe('exclusão de conta', () => {
    const fulfill = async (user: SignedUp) => {
      await t
        .http()
        .post('/v1/me/deletion-request')
        .set(...bearer(user))
        .send({ password: PASSWORD })
        .expect(201);
      const { body } = await t
        .http()
        .get('/v1/super/deletion-requests?status=PENDING')
        .set(...bearer(superUser))
        .expect(200);
      const request = body.items.find((item: { userId: string }) => item.userId === user.id);
      await t
        .http()
        .post(`/v1/super/deletion-requests/${request.id}/fulfill`)
        .set(...bearer(superUser))
        .send({})
        .expect(200);
    };
    const countByEmail = async (email: string) =>
      (await t.db.select().from(contacts).where(eq(contacts.email, email))).length;

    it('apaga o contato vinculado e os touchpoints; o histórico do espaço fica', async () => {
      const booking = await guestIn(spaceA, { name: 'Titular', email: 'titular@exemplo.com' });
      const account = await signUp(t, 'titular@exemplo.com', 'Titular');
      await verifyEmail(t, 'titular@exemplo.com');
      const [contact] = await t.db
        .select()
        .from(contacts)
        .where(eq(contacts.email, 'titular@exemplo.com'));
      expect(contact?.userId).toBe(account.id);

      await fulfill(account);

      expect(await countByEmail('titular@exemplo.com')).toBe(0);
      expect(
        await t.db
          .select()
          .from(contactTouchpoints)
          .where(eq(contactTouchpoints.contactId, contact?.id ?? '')),
      ).toEqual([]);
      const rows = await t.db
        .select()
        .from(bookingParticipants)
        .where(eq(bookingParticipants.bookingId, booking.id));
      expect(rows.find((row) => row.userId === account.id)).toMatchObject({ contactId: null });
    });

    it('apaga o contato sem vínculo com o e-mail verificado da conta', async () => {
      const account = await signUp(t, 'tardio@exemplo.com', 'Tardio');
      await verifyEmail(t, 'tardio@exemplo.com');
      await guestIn(spaceA, { name: 'Tardio', email: 'tardio@exemplo.com' });
      await fulfill(account);
      expect(await countByEmail('tardio@exemplo.com')).toBe(0);
    });

    it('apaga o touchpoint de outro contato que guarda o telefone verificado da conta', async () => {
      const phone = '+5531944440030';
      const account = await signUp(t, 'telefone@exemplo.com', 'Telefone');
      await verifyPhone(t, account, phone);
      const first = await book(t, organizer, spaceA, nextHours());
      await invite(t, organizer, first.id, { items: [{ phone }] });
      const second = await book(t, organizer, spaceA, nextHours());
      await invite(t, organizer, second.id, {
        items: [{ email: 'terceiro@exemplo.com', phone }],
      });

      await fulfill(account);

      expect(await countByEmail('terceiro@exemplo.com')).toBe(1);
      expect(
        await t.db.select().from(contactTouchpoints).where(eq(contactTouchpoints.phone, phone)),
      ).toEqual([]);
    });

    it('conta com e-mail sem verificação não apaga o contato de quem é dono dele', async () => {
      await guestIn(spaceA, { name: 'Dono Real', email: 'dono-real@exemplo.com' });
      const impostor = await signUp(t, 'dono-real@exemplo.com', 'Impostor');
      await fulfill(impostor);
      expect(await countByEmail('dono-real@exemplo.com')).toBe(1);
    });
  });

  describe('dados por espaço (decisão 48)', () => {
    const phone = '+5531944440020';
    let row: Row | undefined;

    const deskInB = (guestName: string, guestPhone: string) =>
      t
        .http()
        .post(`/v1/manage/spaces/${spaceB.id}/bookings`)
        .set(...bearer(adminB))
        .send({
          courtId: spaceB.courtB,
          sportId: spaceB.sportId,
          startsAt: slotIn(nextHours() * 60).toISOString(),
          durationMin: 60,
          peopleCount: 2,
          guestName,
          guestPhone,
        })
        .expect(201);

    beforeAll(async () => {
      await guestIn(spaceA, {
        name: 'Nome em A',
        email: 'privado-a@exemplo.com',
        phone,
        marketingConsent: true,
      });
      await deskInB('Nome em B', phone);
      const { items } = await spaceList(spaceB, adminB, `?q=${encodeURIComponent(phone)}`);
      row = items[0];
    });

    it('B cria balcão com telefone de A e não vê nome, e-mail nem consentimento de A', () => {
      expect(row).toMatchObject({
        name: 'Nome em B',
        email: null,
        phone,
        marketingConsentAt: null,
        unsubscribedAt: null,
        origins: ['DESK_BOOKING'],
      });
      expect(JSON.stringify(row)).not.toContain('Nome em A');
      expect(JSON.stringify(row)).not.toContain('privado-a@exemplo.com');
    });

    it('a busca e os filtros de B não revelam o que foi informado em A', async () => {
      expect((await spaceList(spaceB, adminB, '?q=Nome%20em%20A')).items).toEqual([]);
      expect((await spaceList(spaceB, adminB, '?q=privado-a@exemplo')).items).toEqual([]);
      const consent = await spaceList(spaceB, adminB, '?consent=true');
      expect(consent.items.map((item) => item.id)).not.toContain(row?.id);
      const origin = await spaceList(spaceB, adminB, '?origin=BOOKING_INVITE_SELF');
      expect(origin.items.map((item) => item.id)).not.toContain(row?.id);
      const own = await spaceList(spaceB, adminB, '?origin=DESK_BOOKING&q=Nome%20em%20B');
      expect(own.items.map((item) => item.id)).toEqual([row?.id]);
    });

    it('o CSV de B não traz quem só deu consentimento em A; o de A traz os dados de A', async () => {
      const b = await spaceExport(spaceB, adminB).expect(200);
      expect(b.text).not.toContain(phone);
      expect(b.text).not.toContain('Nome em');
      expect(b.text).not.toContain('privado-a@exemplo.com');

      const a = await spaceExport(spaceA, ownerA).expect(200);
      const line = csvRows(a.text).find((item) => item.includes(phone));
      expect(line?.split(',').slice(0, 3)).toEqual(['Nome em A', 'privado-a@exemplo.com', phone]);
      expect(a.text).not.toContain('Nome em B');
    });

    it('com consentimento dado em B, o CSV de B mostra só o que foi informado em B', async () => {
      await guestIn(spaceB, {
        name: 'Nome em B',
        phone,
        marketingConsent: true,
      });
      const b = await spaceExport(spaceB, adminB).expect(200);
      const line = csvRows(b.text).find((item) => item.includes(phone));
      expect(line?.split(',').slice(0, 3)).toEqual(['Nome em B', '', phone]);
      expect(b.text).not.toContain('privado-a@exemplo.com');
    });

    it('o Super vê os dados globais e o que foi informado em cada espaço', async () => {
      const { items } = await superList(`?q=${encodeURIComponent(phone)}`);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        name: 'Nome em A',
        email: 'privado-a@exemplo.com',
        phone,
      });
      expect(items[0]?.marketingConsentAt).toEqual(expect.any(String));
      const bySpace = new Map(items[0]?.spaces?.map((space) => [space.spaceId, space]));
      expect(bySpace.get(spaceA.id)).toMatchObject({
        name: 'Nome em A',
        email: 'privado-a@exemplo.com',
      });
      expect(bySpace.get(spaceB.id)).toMatchObject({ name: 'Nome em B', email: null });
    });

    it('o descadastro vale para todos, e só aparece a quem tinha consentimento', async () => {
      const unsubscribedPhone = '+5531944440021';
      await guestIn(spaceA, {
        name: 'Saiu em A',
        phone: unsubscribedPhone,
        marketingConsent: true,
      });
      await deskInB('Saiu em B', unsubscribedPhone);
      const exported = await superExport(`?q=${encodeURIComponent(unsubscribedPhone)}`).expect(200);
      const token = csvRows(exported.text)[1]?.split('/descadastro/')[1] ?? '';
      await t.http().post('/v1/public/contacts/unsubscribe').send({ token }).expect(200);

      const query = `?q=${encodeURIComponent(unsubscribedPhone)}`;
      const inB = await spaceList(spaceB, adminB, query);
      expect(inB.items[0]?.unsubscribedAt).toBeNull();
      const inA = await spaceList(spaceA, ownerA, query);
      expect(inA.items[0]?.unsubscribedAt).toEqual(expect.any(String));
      const a = await spaceExport(spaceA, ownerA).expect(200);
      expect(a.text).not.toContain(unsubscribedPhone);
    });
  });
});
