import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { Public } from '../auth/decorators.js';
import type { Database } from '../db/client.js';
import { amenities, cities, sports } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { ApiZodResponse } from '../openapi/zod-openapi.js';
import { amenityListSchema, cityListSchema, sportListSchema } from './spaces.openapi.js';

/** Catálogos públicos (geridos no Super): esportes, infraestrutura e cidades. */
@ApiTags('catalog')
@Public()
@Controller()
export class CatalogController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get('sports')
  @ApiOperation({ operationId: 'listSports', summary: 'Esportes do catálogo' })
  @ApiZodResponse(sportListSchema)
  async sports(): Promise<z.infer<typeof sportListSchema>> {
    const items = await this.db
      .select({
        id: sports.id,
        slug: sports.slug,
        name: sports.name,
        icon: sports.icon,
        defaultMaxPlayers: sports.defaultMaxPlayers,
      })
      .from(sports)
      .orderBy(asc(sports.name));
    return { items };
  }

  @Get('amenities')
  @ApiOperation({
    operationId: 'listAmenities',
    summary: 'Itens de infraestrutura do catálogo (RF-SPACE-02)',
  })
  @ApiZodResponse(amenityListSchema)
  async amenities(): Promise<z.infer<typeof amenityListSchema>> {
    const items = await this.db
      .select({
        id: amenities.id,
        slug: amenities.slug,
        name: amenities.name,
        icon: amenities.icon,
      })
      .from(amenities)
      .orderBy(asc(amenities.name));
    return { items };
  }

  @Get('cities')
  @ApiOperation({ operationId: 'listCities', summary: 'Cidades ativas' })
  @ApiZodResponse(cityListSchema)
  async cities(): Promise<z.infer<typeof cityListSchema>> {
    const items = await this.db
      .select({ id: cities.id, name: cities.name, state: cities.state })
      .from(cities)
      .where(eq(cities.active, true))
      .orderBy(asc(cities.name));
    return { items };
  }
}
