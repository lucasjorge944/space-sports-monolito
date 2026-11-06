import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type AvailabilityResponse,
  type BookingDetail,
  type CourtBlock,
  type courtSchema,
  type favoriteListSchema,
  type InvitePreview,
  type Membership,
  type MeResponse,
  type managedSpaceSchema,
  meResponseSchema,
  type PaymentRecord,
  PlatformRole,
  type PlayerBookingDetail,
  type PlayerBookingPage,
  type publicSpaceSchema,
  type ReceivablesToday,
  type SpaceBookingDetail,
  type SpaceBookingPage,
  SpaceRole,
  type spaceCardSchema,
  type spaceSearchResultSchema,
  type spaceSettingsSchema,
} from '.';
import type {
  AvailabilityResponseDto,
  BookingDetailDto,
  Court,
  CourtBlockDto,
  InvitePreviewDto,
  ManagedSpace,
  MembershipDto,
  MeResponseDto,
  PaymentRecordDto,
  PlayerBookingDetailDto,
  PlayerBookingPageDto,
  PublicSpace,
  ReceivablesTodayDto,
  SpaceBookingDetailDto,
  SpaceBookingPageDto,
  SpaceCard,
  SpaceSearchResult,
  SpaceSettings,
} from './generated/model';

const me: MeResponseDto = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  name: 'Maria Souza',
  email: 'maria@exemplo.com',
  emailVerified: true,
  phone: '+5531999998888',
  phoneVerified: false,
  avatarUrl: null,
  birthDate: '1990-05-17',
  gender: 'FEMALE',
  favoriteSports: [
    {
      sport: { id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d', name: 'Futevôlei', slug: 'futevolei' },
      level: null,
    },
  ],
  profile: { missing: [] },
  platformRole: PlatformRole.USER,
  memberships: [
    {
      space: {
        id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
        name: 'Arena 7',
        slug: 'arena-7',
        status: 'ACTIVE',
        logoUrl: null,
      },
      roles: [SpaceRole.OWNER],
    },
  ],
  access: { super: false, management: true },
};

describe('tipos gerados x schemas de @space-sports/shared', () => {
  it('MeResponseDto (OpenAPI) e MeResponse (Zod) são o mesmo formato', () => {
    expectTypeOf<MeResponseDto>().toEqualTypeOf<MeResponse>();
    expectTypeOf<MembershipDto>().toEqualTypeOf<Membership>();
  });

  it('DTOs de reservas e pagamentos batem com os schemas de booking.ts', () => {
    expectTypeOf<AvailabilityResponseDto>().toEqualTypeOf<AvailabilityResponse>();
    expectTypeOf<BookingDetailDto>().toEqualTypeOf<BookingDetail>();
    expectTypeOf<SpaceBookingDetailDto>().toEqualTypeOf<SpaceBookingDetail>();
    expectTypeOf<SpaceBookingPageDto>().toEqualTypeOf<SpaceBookingPage>();
    expectTypeOf<PlayerBookingDetailDto>().toEqualTypeOf<PlayerBookingDetail>();
    expectTypeOf<PlayerBookingPageDto>().toEqualTypeOf<PlayerBookingPage>();
    expectTypeOf<InvitePreviewDto>().toEqualTypeOf<InvitePreview>();
    expectTypeOf<PaymentRecordDto>().toEqualTypeOf<PaymentRecord>();
    expectTypeOf<CourtBlockDto>().toEqualTypeOf<CourtBlock>();
    expectTypeOf<ReceivablesTodayDto>().toEqualTypeOf<ReceivablesToday>();
  });

  it('DTOs de espaços e quadras batem com os schemas de spaces.ts', () => {
    expectTypeOf<Court>().toEqualTypeOf<ReturnType<typeof courtSchema.parse>>();
    expectTypeOf<ManagedSpace>().toEqualTypeOf<ReturnType<typeof managedSpaceSchema.parse>>();
    expectTypeOf<PublicSpace>().toEqualTypeOf<ReturnType<typeof publicSpaceSchema.parse>>();
    expectTypeOf<SpaceCard>().toEqualTypeOf<ReturnType<typeof spaceCardSchema.parse>>();
    expectTypeOf<SpaceSearchResult>().toEqualTypeOf<
      ReturnType<typeof spaceSearchResultSchema.parse>
    >();
    expectTypeOf<SpaceSettings>().toEqualTypeOf<ReturnType<typeof spaceSettingsSchema.parse>>();
    expectTypeOf<ReturnType<typeof favoriteListSchema.parse>['items']>().toEqualTypeOf<
      SpaceCard[]
    >();
  });

  it('meResponseSchema valida a resposta tipada pelo cliente', () => {
    expect(meResponseSchema.parse(me)).toEqual(me);
  });
});
