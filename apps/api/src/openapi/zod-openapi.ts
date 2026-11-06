import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiBody, ApiParam, ApiQuery, ApiResponse, type OpenAPIObject } from '@nestjs/swagger';
import { z } from 'zod';

// OpenAPI a partir dos schemas Zod de @space-sports/shared: o mesmo schema valida a entrada e
// documenta o contrato, sem DTO duplicado. Cada schema de corpo/resposta vira um componente
// nomeado (`#/components/schemas/<Nome>`), que o orval transforma em tipo do cliente.

type SchemaObject = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
type Io = 'input' | 'output';
const registries: Record<Io, z.core.$ZodRegistry<{ id: string }>> = {
  input: z.registry<{ id: string }>(),
  output: z.registry<{ id: string }>(),
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

/**
 * Registra o schema como componente. `input` para corpos de requisição (defaults opcionais),
 * `output` para respostas. Enums e objetos reaproveitados podem ser registrados nos dois.
 */
export function openApiSchema<T extends z.ZodType>(schema: T, name: string, io: Io): T {
  const registry = registries[io];
  if (!registry.has(schema)) registry.add(schema, { id: name });
  return schema;
}

/** Componentes gerados a partir dos registros, para juntar ao documento do Nest. */
export function zodComponents(): Record<string, SchemaObject> {
  const result: Record<string, SchemaObject> = {};
  for (const io of ['output', 'input'] as const) {
    const { schemas } = z.toJSONSchema(registries[io], {
      target: 'openapi-3.0',
      io,
      unrepresentable: 'any',
      uri: (id) => `#/components/schemas/${id}`,
    });
    for (const [name, schema] of Object.entries(schemas)) {
      if (result[name] && io === 'input') {
        // O mesmo nome nos dois registros precisa descrever a mesma coisa.
        if (JSON.stringify(result[name]) !== JSON.stringify(clean(schema, io))) {
          throw new Error(`Componente OpenAPI "${name}" difere entre entrada e saída.`);
        }
        continue;
      }
      result[name] = clean(schema, io) as SchemaObject;
    }
  }
  return result;
}

/** Junta os componentes Zod ao documento do Nest. */
export function mergeZodComponents(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.schemas = { ...document.components.schemas, ...zodComponents() };
  return document;
}

/**
 * Tira `$id` e os limites de inteiro seguro que o Zod acrescenta (ruído no cliente). Nas
 * respostas, tira também o `additionalProperties: false` (o cliente não envia esses objetos).
 */
function clean(value: unknown, io: Io = 'input'): unknown {
  if (Array.isArray(value)) return value.map((item) => clean(item, io));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === '$id') continue;
    if (io === 'output' && key === 'additionalProperties' && child === false) continue;
    if (key === 'pattern' && (value as { format?: unknown }).format === 'uuid') continue;
    if (key === 'minimum' && child === Number.MIN_SAFE_INTEGER) continue;
    if (key === 'maximum' && child === Number.MAX_SAFE_INTEGER) continue;
    out[key] = clean(child, io);
  }
  return out;
}

function nameOf(schema: z.ZodType, io: Io): string {
  const meta = registries[io].get(schema);
  if (!meta) throw new Error(`Schema sem openApiSchema(..., '${io}').`);
  return meta.id;
}

/** Corpo da requisição validado por `schema` (registrado como `input`). */
export const ApiZodBody = (schema: z.ZodType) => ApiBody({ schema: ref(nameOf(schema, 'input')) });

/** Resposta de sucesso descrita por `schema` (registrado como `output`). */
export const ApiZodResponse = (schema: z.ZodType, status: HttpStatus = HttpStatus.OK) =>
  ApiResponse({ status, schema: ref(nameOf(schema, 'output')) });

/** Um `@ApiQuery` por campo do objeto (query string). */
export function ApiZodQuery(schema: z.ZodObject) {
  return applyDecorators(
    ...Object.entries(schema.shape).map(([name, field]) => {
      const fieldSchema = field as z.ZodType;
      const json = clean(
        z.toJSONSchema(fieldSchema, { target: 'openapi-3.0', io: 'input', unrepresentable: 'any' }),
      ) as SchemaObject & { $schema?: string };
      delete json.$schema;
      return ApiQuery({
        name,
        required: !fieldSchema.safeParse(undefined).success,
        schema: json,
        ...(fieldSchema.description ? { description: fieldSchema.description } : {}),
      });
    }),
  );
}

/** Parâmetro de rota uuid. */
export const ApiUuidParam = (name: string, description?: string) =>
  ApiParam({
    name,
    schema: { type: 'string', format: 'uuid' },
    ...(description ? { description } : {}),
  });
