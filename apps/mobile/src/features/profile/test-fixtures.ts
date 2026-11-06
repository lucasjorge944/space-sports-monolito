import type { MeResponse } from '@space-sports/api-client';

export const SPORTS = [
  { id: '0192f0a0-0000-7000-8000-0000000000a1', slug: 'beach-tennis', name: 'Beach tennis' },
  { id: '0192f0a0-0000-7000-8000-0000000000a2', slug: 'futevolei', name: 'Futevôlei' },
].map((s) => ({ ...s, icon: null, defaultMaxPlayers: null }));

export const makeMe = (overrides: Partial<MeResponse> = {}): MeResponse => ({
  id: '0192f0a0-0000-7000-8000-000000000001',
  name: 'Ana Souza',
  email: 'ana@example.com',
  emailVerified: false,
  phone: '+5531999998888',
  phoneVerified: false,
  avatarUrl: null,
  birthDate: null,
  gender: null,
  favoriteSports: [],
  profile: { missing: [] },
  platformRole: 'USER',
  memberships: [],
  access: { super: false, management: false },
  ...overrides,
});
