import { ApiProperty } from '@nestjs/swagger';
import {
  type FavoriteSport,
  GENDERS,
  type Gender,
  type Membership,
  type MeResponse,
  PLATFORM_ROLES,
  type PlatformRole,
  PROFILE_REQUIRED_FIELDS,
  type ProfileRequiredField,
  SPACE_ROLES,
  SPACE_STATUSES,
  SPORT_LEVELS,
  type SpaceRole,
  type SpaceStatus,
  type SportLevel,
} from '@space-sports/shared';

// DTOs do OpenAPI espelhando meResponseSchema (@space-sports/shared); o `implements` mantém os
// dois em sincronia na compilação.

type MembershipSpace = Membership['space'];
type MeAccess = MeResponse['access'];
type MeProfile = MeResponse['profile'];
type FavoriteSportRef = FavoriteSport['sport'];

class MembershipSpaceDto implements MembershipSpace {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Arena 7' })
  name!: string;

  @ApiProperty({ example: 'arena-7' })
  slug!: string;

  @ApiProperty({ enum: SPACE_STATUSES, enumName: 'SpaceStatus' })
  status!: SpaceStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Logo do espaço (RF-SPACE-11); nula = iniciais do nome no seletor do painel.',
  })
  logoUrl!: string | null;
}

class MembershipDto implements Membership {
  @ApiProperty({ type: MembershipSpaceDto })
  space!: MembershipSpaceDto;

  @ApiProperty({
    enum: SPACE_ROLES,
    enumName: 'SpaceRole',
    isArray: true,
    description: 'Papéis ativos do usuário neste espaço (pelo menos um).',
  })
  roles!: SpaceRole[];
}

class MeAccessDto implements MeAccess {
  @ApiProperty({ description: 'RN-AUTH-02: pode entrar no painel Super (/super).' })
  super!: boolean;

  @ApiProperty({
    description:
      'RN-AUTH-01/RN-AUTH-04: tem vínculo de gestão em algum espaço (/painel no web, modo gestão no app).',
  })
  management!: boolean;
}

class FavoriteSportRefDto implements FavoriteSportRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Futevôlei' })
  name!: string;

  @ApiProperty({ example: 'futevolei' })
  slug!: string;
}

// Enums anuláveis ficam inline (sem enumName): com $ref, o OpenAPI 3.0 perde o `nullable` e o
// tipo gerado deixaria de aceitar nulo.

class FavoriteSportDto implements FavoriteSport {
  @ApiProperty({ type: FavoriteSportRefDto })
  sport!: FavoriteSportRefDto;

  @ApiProperty({
    enum: SPORT_LEVELS,
    nullable: true,
    description: 'Nível do jogador no esporte (decisão 69); nulo = não informado.',
  })
  level!: SportLevel | null;
}

class MeProfileDto implements MeProfile {
  @ApiProperty({
    enum: PROFILE_REQUIRED_FIELDS,
    enumName: 'ProfileRequiredField',
    isArray: true,
    description:
      'Decisão 66: o que a etapa "completar cadastro" ainda exige (nome e/ou telefone). Vazio = cadastro completo; enquanto não estiver vazio, o app e o painel pedem os dados antes de seguir. Nascimento, gênero e esportes nunca entram.',
  })
  missing!: ProfileRequiredField[];
}

export class MeResponseDto implements MeResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    example: 'Maria Souza',
    description:
      'Vazio se a conta foi criada pelo telefone e o nome ainda não foi informado (`profile.missing` traz `name`).',
  })
  name!: string;

  @ApiProperty({ type: String, format: 'email', nullable: true, example: 'maria@exemplo.com' })
  email!: string | null;

  @ApiProperty()
  emailVerified!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '+5531999998888',
    description:
      'E.164. Informado no cadastro sem verificação (decisão 64); nulo em conta antiga ou criada pelo Google, até o "completar cadastro".',
  })
  phone!: string | null;

  @ApiProperty({
    description:
      'Telefone confirmado por OTP. O do cadastro e o trocado no perfil ficam `false` e não provam identidade (não vinculam contatos nem servem para login).',
  })
  phoneVerified!: boolean;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '1990-05-17',
    description: 'Data civil (sem fuso), decisão 68.',
  })
  birthDate!: string | null;

  @ApiProperty({
    enum: GENDERS,
    nullable: true,
    description:
      'Decisão 68: Feminino, Masculino, Outro ou Prefiro não informar (`UNDISCLOSED`); nulo = não respondido.',
  })
  gender!: Gender | null;

  @ApiProperty({
    type: FavoriteSportDto,
    isArray: true,
    description: 'Esportes favoritos com o nível opcional (decisão 69), pelo nome do esporte.',
  })
  favoriteSports!: FavoriteSportDto[];

  @ApiProperty({ type: MeProfileDto })
  profile!: MeProfileDto;

  @ApiProperty({ enum: PLATFORM_ROLES, enumName: 'PlatformRole' })
  platformRole!: PlatformRole;

  @ApiProperty({
    type: MembershipDto,
    isArray: true,
    description: 'Vínculos ativos com espaços, ordenados pelo nome do espaço.',
  })
  memberships!: MembershipDto[];

  @ApiProperty({ type: MeAccessDto })
  access!: MeAccessDto;
}
