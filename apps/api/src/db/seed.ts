import { courtCapacity } from '@space-sports/shared';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { normalizeEmail } from '../users/normalize.js';
import type { Database } from './client.js';
import {
  accounts,
  amenities,
  cities,
  courtSports,
  courts,
  platformFeeSettings,
  spaceSettings,
  spaces,
  sports,
  users,
} from './schema/index.js';

export const SEED_SPORTS = [
  // default_max_players: limite padrão de jogadores por quadra; o máximo é 20 (decisão 18 em docs/07).
  { slug: 'futevolei', name: 'Futevôlei', defaultMaxPlayers: 20 },
  { slug: 'beach-tennis', name: 'Beach Tennis', defaultMaxPlayers: 20 },
  { slug: 'volei-praia', name: 'Vôlei de Praia', defaultMaxPlayers: 20 },
] as const;

/** Catálogo de infraestrutura de RF-SPACE-02. */
export const SEED_AMENITIES = [
  { slug: 'banheiro', name: 'Banheiro' },
  { slug: 'vestiario', name: 'Vestiário' },
  { slug: 'chuveiro', name: 'Chuveiro' },
  { slug: 'bar-lanchonete', name: 'Bar/lanchonete' },
  { slug: 'estacionamento', name: 'Estacionamento' },
  { slug: 'iluminacao-noturna', name: 'Iluminação noturna' },
  { slug: 'aluguel-equipamento', name: 'Aluguel de equipamento' },
  { slug: 'acessibilidade', name: 'Acessibilidade' },
  { slug: 'wi-fi', name: 'Wi-Fi' },
] as const;

export const SEED_CITY = {
  name: 'Belo Horizonte',
  state: 'MG',
  timezone: 'America/Sao_Paulo',
} as const;

/**
 * Espaços parceiros (docs/08-espacos-parceiros.md, decisão 43), identificados pelo `slug`. Só
 * nome, slug, cidade, status e as quadras: endereço, localização, contatos, logo, preços e
 * horários ficam vazios até a implantação, que os preenche pelo painel (o seed não os altera
 * depois de criados).
 *
 * - A Duna Sports substituiu a Arena 7; a cidade dela (Belo Horizonte/MG) é provisória até a
 *   confirmação. O seed não apaga espaços que já existam (uma Arena 7 criada antes continua lá).
 * - `courts`: quantidade de quadras, criadas como "Quadra 1".."Quadra N", descobertas, ACTIVE e
 *   com os três esportes do catálogo (capacidade = `default_max_players` do esporte). Só entram
 *   no parceiro que ainda não tem nenhuma quadra, para não mexer no que a implantação cadastrou.
 */
export const SEED_PARTNER_SPACES = [
  { name: 'Astral Beach Sports', slug: 'astral-beach-sports', courts: 3 },
  { name: 'Arena Errejota', slug: 'arena-errejota', courts: 2 },
  { name: 'Duna Sports', slug: 'duna-sports', courts: 2 },
] as const;

/** `provider_id` da conta de e-mail + senha no Better Auth. */
export const CREDENTIAL_PROVIDER_ID = 'credential';

export type SeedSuperUser = { email: string; name: string; password?: string | undefined };

export type SeedOptions = {
  /**
   * Usuário Super (SEED_SUPER_EMAIL/SEED_SUPER_NAME/SEED_SUPER_PASSWORD). Sem ele, o passo é
   * pulado. Sem senha, o Super só entra pelo "esqueci a senha".
   */
  superUser?: SeedSuperUser | undefined;
};

/**
 * SEED_SUPER_EMAIL já pertence a uma conta que o seed não criou (ex.: cadastro público pelo app).
 * O seed não promove essa conta a SUPER: seria escalada de privilégio para quem se cadastrou
 * antes com o e-mail do Super.
 */
export class SeedSuperUserConflictError extends Error {
  constructor(email: string) {
    super(
      `SEED_SUPER_EMAIL (${email}) já pertence a uma conta que não foi criada pelo seed ` +
        '(cadastro pelo app, e-mail não verificado ou senha diferente de SEED_SUPER_PASSWORD). ' +
        'O seed não promove contas existentes a SUPER. Confirme quem é o dono da conta e remova-a, ' +
        'ou use outro e-mail.',
    );
    this.name = 'SeedSuperUserConflictError';
  }
}

/**
 * Seed da **criação inicial** do banco (dev, staging e o primeiro deploy de produção). Não é
 * ferramenta de manutenção de dados.
 *
 * - Idempotente: pode rodar quantas vezes for preciso sem duplicar nada.
 * - Insere só o que falta e nunca sobrescreve dados existentes. A senha do Super só é gravada se
 *   ainda não houver uma (trocar SEED_SUPER_PASSWORD depois não altera a senha; use o "esqueci a
 *   senha").
 * - Nunca promove a SUPER uma conta que ele não criou: se SEED_SUPER_EMAIL já for de outra conta,
 *   falha com SeedSuperUserConflictError (ver `seedSuperUser`).
 * - Identifica cada registro pela chave natural: esportes e amenities pelo `slug`, a cidade por
 *   nome + UF e os espaços parceiros pelo `slug`. As quadras dos parceiros só são criadas no
 *   espaço que não tem nenhuma. Se o Super mudar o slug de um parceiro, uma
 *   nova execução cria outro espaço com o slug original. Por isso, depois da implantação,
 *   alterações nesses dados são feitas pelo painel Super, e não editando este seed.
 */
export async function seed(db: Database, options: SeedOptions = {}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(sports)
      .values([...SEED_SPORTS])
      .onConflictDoNothing({ target: sports.slug });

    await tx
      .insert(amenities)
      .values([...SEED_AMENITIES])
      .onConflictDoNothing({ target: amenities.slug });

    await tx
      .insert(cities)
      .values(SEED_CITY)
      .onConflictDoNothing({ target: [cities.name, cities.state] });
    const [city] = await tx
      .select({ id: cities.id })
      .from(cities)
      .where(and(eq(cities.name, SEED_CITY.name), eq(cities.state, SEED_CITY.state)));
    if (!city) throw new Error('Cidade do seed não encontrada após o insert.');

    await tx
      .insert(spaces)
      .values(
        SEED_PARTNER_SPACES.map(({ name, slug }) => ({
          name,
          slug,
          cityId: city.id,
          status: 'ACTIVE' as const,
        })),
      )
      .onConflictDoNothing({ target: spaces.slug });

    // Configurações com os valores nulos ("não configurado") para os espaços que ainda não têm.
    const partnerSpaces = await tx
      .select({ id: spaces.id, slug: spaces.slug })
      .from(spaces)
      .where(
        inArray(
          spaces.slug,
          SEED_PARTNER_SPACES.map((space) => space.slug),
        ),
      );
    await tx
      .insert(spaceSettings)
      .values(partnerSpaces.map((space) => ({ spaceId: space.id })))
      .onConflictDoNothing({ target: spaceSettings.spaceId });

    await seedPartnerCourts(tx, partnerSpaces);

    // Taxa padrão do pagamento online (decisão 83), criada na migração 0025; recriada se faltar.
    await tx
      .insert(platformFeeSettings)
      .values({ id: 1, pixFeeBps: 400, cardFeeBps: 600, minFeeCents: 100, feePayer: 'SPACE' })
      .onConflictDoNothing({ target: platformFeeSettings.id });

    if (options.superUser) await seedSuperUser(tx, options.superUser);
  });
}

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Quadras dos parceiros que ainda não têm nenhuma (ver `SEED_PARTNER_SPACES`). */
async function seedPartnerCourts(tx: Transaction, partnerSpaces: { id: string; slug: string }[]) {
  const catalog = await tx
    .select({ id: sports.id, defaultMaxPlayers: sports.defaultMaxPlayers })
    .from(sports)
    .where(
      inArray(
        sports.slug,
        SEED_SPORTS.map((sport) => sport.slug),
      ),
    );
  for (const space of partnerSpaces) {
    const count = SEED_PARTNER_SPACES.find((partner) => partner.slug === space.slug)?.courts ?? 0;
    // Trava o espaço: duas execuções simultâneas não criam as quadras duas vezes.
    await tx.execute(sql`SELECT 1 FROM ${spaces} WHERE ${spaces.id} = ${space.id} FOR UPDATE`);
    if (!count || (await tx.$count(courts, eq(courts.spaceId, space.id))) > 0) continue;

    const created = await tx
      .insert(courts)
      .values(
        Array.from({ length: count }, (_, index) => ({
          spaceId: space.id,
          name: `Quadra ${index + 1}`,
          covered: false,
          status: 'ACTIVE' as const,
        })),
      )
      .returning({ id: courts.id });
    await tx.insert(courtSports).values(
      created.flatMap((court) =>
        catalog.map((sport) => ({
          courtId: court.id,
          sportId: sport.id,
          maxPlayers: courtCapacity(sport.defaultMaxPlayers),
        })),
      ),
    );
  }
}

/**
 * Cria o usuário Super ou, se ele já existe, mantém tudo como está (idempotente). Conta existente
 * com o e-mail do Super só é aceita se for dele:
 * - já é SUPER: é o Super do seed (o papel não é concedido por outro caminho);
 * - não é SUPER (ex.: rebaixado): só volta a SUPER com e-mail verificado e a senha atual igual a
 *   SEED_SUPER_PASSWORD. Um cadastro público com o mesmo e-mail falha aqui, sem ser promovido.
 */
async function seedSuperUser(tx: Transaction, { email, name, password }: SeedSuperUser) {
  const normalizedEmail = normalizeEmail(email);
  const [existing] = await tx
    .select({ id: users.id, platformRole: users.platformRole, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .for('update');

  if (!existing) {
    // Insert simples: um cadastro concorrente com o mesmo e-mail faz o seed falhar (UNIQUE).
    const [created] = await tx
      .insert(users)
      .values({
        email: normalizedEmail,
        // O e-mail vem de quem opera o deploy: já nasce verificado.
        emailVerified: true,
        emailVerifiedAt: new Date(),
        name: name.trim(),
        platformRole: 'SUPER',
      })
      .returning({ id: users.id });
    if (!created) throw new Error('Usuário Super não encontrado após o insert.');
    if (password) await insertCredential(tx, created.id, password);
    return;
  }

  if (existing.platformRole !== 'SUPER') {
    const credential = await credentialHash(tx, existing.id);
    const ownsAccount =
      existing.emailVerified &&
      password !== undefined &&
      credential !== null &&
      (await verifyPassword({ hash: credential, password }));
    if (!ownsAccount) throw new SeedSuperUserConflictError(normalizedEmail);
    await tx.update(users).set({ platformRole: 'SUPER' }).where(eq(users.id, existing.id));
    return;
  }

  if (password) await insertCredential(tx, existing.id, password);
}

/** Conta de e-mail + senha, se ainda não existir (nunca troca a senha). */
export async function insertCredential(tx: Transaction, userId: string, password: string) {
  await tx
    .insert(accounts)
    .values({
      userId,
      providerId: CREDENTIAL_PROVIDER_ID,
      // Como o Better Auth grava a conta de e-mail + senha: account_id = id do usuário.
      accountId: userId,
      password: await hashPassword(password),
    })
    .onConflictDoNothing({ target: [accounts.providerId, accounts.accountId] });
}

export async function credentialHash(tx: Transaction, userId: string): Promise<string | null> {
  const [credential] = await tx
    .select({ password: accounts.password })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, CREDENTIAL_PROVIDER_ID)));
  return credential?.password ?? null;
}
