import { makeSuper, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';

export { createSpace, member, seedCatalog, setSpaceStatus } from '../spaces/fixtures.js';

export const bearer = (user: SignedUp) => ['authorization', `Bearer ${user.token}`] as const;

/** Usuário com o papel de plataforma SUPER. */
export async function superUser(t: TestApp, email: string): Promise<SignedUp> {
  const user = await signUp(t, email, 'Super Teste');
  await makeSuper(t.db, user.id);
  return user;
}

export const NIL_UUID = '00000000-0000-4000-8000-000000000000';

/** Item de uma lista da resposta (o `res.body` do supertest é `any`). */
export interface Row {
  [field: string]: unknown;
}
