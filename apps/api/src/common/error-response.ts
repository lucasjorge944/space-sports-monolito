import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export interface FieldError {
  field: string;
  message: string;
  code: string;
}

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
  requestId: string | null;
}

class ErrorPayloadDto {
  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code!: string;

  @ApiProperty({ example: 'Dados inválidos.' })
  message!: string;

  @ApiPropertyOptional({
    description: 'Detalhes do erro. Em VALIDATION_ERROR, uma lista de erros por campo.',
    example: [{ field: 'email', message: 'Invalid email address', code: 'invalid_format' }],
  })
  details?: unknown;
}

/** Formato padrão de erro da API (documentado no OpenAPI). */
export class ErrorResponseDto implements ErrorBody {
  @ApiProperty({ type: ErrorPayloadDto })
  error!: ErrorPayloadDto;

  @ApiProperty({ type: String, nullable: true, example: '0b6f6c1e-8a3d-4c7e-9d2a-5f1e2b3c4d5e' })
  requestId!: string | null;
}
