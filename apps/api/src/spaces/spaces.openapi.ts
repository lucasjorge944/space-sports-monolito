import {
  amenitySchema,
  attendanceModeSchema,
  citySchema,
  courtListSchema,
  courtSchema,
  courtStatusSchema,
  createCourtSchema,
  createLogoUploadSchema,
  createPhotoSchema,
  createPhotoUploadSchema,
  favoriteListSchema,
  geoPointSchema,
  logoUploadSchema,
  managedSpaceSchema,
  openingHourSchema,
  paymentMethodSchema,
  photoSchema,
  photoUploadSchema,
  publicSpaceSchema,
  recentSpaceListSchema,
  reorderPhotosSchema,
  replaceAmenitiesSchema,
  replaceOpeningHoursSchema,
  setLogoSchema,
  spaceCardSchema,
  spaceRatingSchema,
  spaceSearchResultSchema,
  spaceServiceSchema,
  spaceSettingsSchema,
  spaceStatusSchema,
  sportSchema,
  updateCourtSchema,
  updateSpaceSchema,
  updateSpaceSettingsSchema,
} from '@space-sports/shared';
import { z } from 'zod';
import { openApiSchema } from '../openapi/zod-openapi.js';

// Componentes OpenAPI do módulo de espaços, a partir dos schemas de @space-sports/shared.

// Enums e objetos reaproveitados (nos dois sentidos quando aparecem em corpo e resposta).
for (const io of ['input', 'output'] as const) {
  openApiSchema(paymentMethodSchema, 'PaymentMethod', io);
  openApiSchema(courtStatusSchema, 'CourtStatus', io);
  openApiSchema(attendanceModeSchema, 'AttendanceMode', io);
  openApiSchema(geoPointSchema, 'GeoPoint', io);
  openApiSchema(openingHourSchema, 'OpeningHour', io);
}
openApiSchema(spaceStatusSchema, 'SpaceStatus', 'output');
openApiSchema(spaceServiceSchema, 'SpaceService', 'output');
openApiSchema(citySchema, 'City', 'output');
openApiSchema(photoSchema, 'Photo', 'output');

export const sportListSchema = openApiSchema(
  z.object({ items: z.array(openApiSchema(sportSchema, 'Sport', 'output')) }),
  'SportList',
  'output',
);
export const amenityListSchema = openApiSchema(
  z.object({ items: z.array(openApiSchema(amenitySchema, 'Amenity', 'output')) }),
  'AmenityList',
  'output',
);
export const cityListSchema = openApiSchema(
  z.object({ items: z.array(citySchema) }),
  'CityList',
  'output',
);
export const photoListSchema = openApiSchema(
  z.object({ items: z.array(photoSchema) }),
  'PhotoList',
  'output',
);

export const schemas = {
  managedSpace: openApiSchema(managedSpaceSchema, 'ManagedSpace', 'output'),
  updateSpace: openApiSchema(updateSpaceSchema, 'UpdateSpaceInput', 'input'),
  replaceAmenities: openApiSchema(replaceAmenitiesSchema, 'ReplaceAmenitiesInput', 'input'),
  replaceOpeningHours: openApiSchema(
    replaceOpeningHoursSchema,
    'ReplaceOpeningHoursInput',
    'input',
  ),
  settings: openApiSchema(spaceSettingsSchema, 'SpaceSettings', 'output'),
  updateSettings: openApiSchema(updateSpaceSettingsSchema, 'UpdateSpaceSettingsInput', 'input'),
  createPhotoUpload: openApiSchema(createPhotoUploadSchema, 'CreatePhotoUploadInput', 'input'),
  photoUpload: openApiSchema(photoUploadSchema, 'PhotoUpload', 'output'),
  createPhoto: openApiSchema(createPhotoSchema, 'CreatePhotoInput', 'input'),
  reorderPhotos: openApiSchema(reorderPhotosSchema, 'ReorderPhotosInput', 'input'),
  photo: photoSchema,
  createLogoUpload: openApiSchema(createLogoUploadSchema, 'CreateLogoUploadInput', 'input'),
  logoUpload: openApiSchema(logoUploadSchema, 'LogoUpload', 'output'),
  setLogo: openApiSchema(setLogoSchema, 'SetLogoInput', 'input'),
  photoList: photoListSchema,
  court: openApiSchema(courtSchema, 'Court', 'output'),
  courtList: openApiSchema(courtListSchema, 'CourtList', 'output'),
  createCourt: openApiSchema(createCourtSchema, 'CreateCourtInput', 'input'),
  updateCourt: openApiSchema(updateCourtSchema, 'UpdateCourtInput', 'input'),
  spaceRating: openApiSchema(spaceRatingSchema, 'SpaceRating', 'output'),
  spaceCard: openApiSchema(spaceCardSchema, 'SpaceCard', 'output'),
  searchResult: openApiSchema(spaceSearchResultSchema, 'SpaceSearchResult', 'output'),
  favoriteList: openApiSchema(favoriteListSchema, 'FavoriteList', 'output'),
  recentSpaceList: openApiSchema(recentSpaceListSchema, 'RecentSpaceList', 'output'),
  publicSpace: openApiSchema(publicSpaceSchema, 'PublicSpace', 'output'),
};
