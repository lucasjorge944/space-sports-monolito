---
name: contrato-api
description: Passo a passo para criar ou alterar um endpoint, DTO ou schema da API do Space Sports mantendo em sincronia o schema Zod (packages/shared), o OpenAPI do NestJS, o api-client gerado pelo orval e os consumidores web/mobile. Use sempre que uma tarefa mexer em controller, rota, corpo, query, resposta ou enum da API, ou quando a CI acusar "API client up to date".
---

# Mudança de contrato da API

O contrato tem uma fonte de verdade e três derivados. Mude na ordem abaixo; pular um passo quebra a CI (`generate:api-client:check`) ou deixa web e mobile com tipos errados.

```
packages/shared (Zod) → apps/api (controller + *.openapi.ts) → packages/api-client (gerado) → apps/web, apps/mobile
```

Modelo a copiar: `apps/api/src/contacts/` (controller, `contacts.openapi.ts`, `contacts.errors.ts`) com os schemas de `packages/shared/src/contacts.ts`.

## 1. Schema em `packages/shared` (api-engineer)
- Defina ou altere o schema Zod no arquivo do domínio (`packages/shared/src/<domínio>.ts`) e exporte o tipo com `z.infer`. Exporte pelo `src/index.ts`.
- Dinheiro em centavos (`z.number().int()`), datas como string ISO em UTC, enums como `z.enum`.
- Regra de negócio pura que web e mobile também usam (ex.: cálculo de preço, permissão) fica aqui, com teste ao lado (`*.test.ts`).

## 2. Controller e OpenAPI em `apps/api` (api-engineer)
- Valide a entrada com `ZodValidationPipe(<schema>)`; documente com `ApiZodBody`, `ApiZodQuery`, `ApiZodResponse` e `ApiUuidParam` de `src/openapi/zod-openapi.ts`.
- Registre os schemas do módulo em `<módulo>.openapi.ts`.
- Todo endpoint novo tem `@ApiOperation({ operationId })` explícito: o nome da função e do hook gerados vem dele (`listSpaceContacts` → `useListSpaceContacts`). Não renomeie `operationId` existente sem combinar com web e mobile: isso quebra os imports deles.
- Permissão com `@ApiAuth` + `@SpacePermission(...)` ou `@SuperOnly`; rota pública só com `@Public` e justificativa.
- Erros pelo `<módulo>.errors.ts`, no formato padrão `{ error: { code, message, details? }, requestId }`. `code` é contrato: web e mobile tratam por ele.
- Mudou o banco? `pnpm db:generate` gera a migração do Drizzle; revise o SQL gerado e commite junto.

## 3. Regenerar o cliente (api-engineer)
Na raiz:

```bash
pnpm generate:api-client        # build da API, export do OpenAPI sem servidor e orval
pnpm generate:api-client:check  # o mesmo teste da CI; precisa passar
```

- `packages/api-client/openapi.json` e `src/generated/` são gerados e **versionados**: commite junto com a mudança da API, nunca edite à mão.
- Leia o diff do `openapi.json`: ele mostra exatamente o que mudou para os clientes. Campo removido, renomeado ou que virou obrigatório é **mudança que quebra**.

## 4. Consumidores (web-engineer, mobile-engineer)
- Use só as funções e os hooks gerados (`useXxx`, `xxx()`), com os tipos de `@space-sports/api-client`. Nada de `fetch` manual nem de tipo duplicado.
- Rode `pnpm typecheck` na raiz: é o que pega os consumidores quebrados.
- Mocks de teste acompanham o contrato: `apps/web/e2e/mock-*.mjs` no web e as fixtures (`test-fixtures.ts`) no mobile.

## 5. Antes de concluir
- `pnpm lint`, `pnpm typecheck`, `pnpm generate:api-client:check` e os testes do pacote alterado (`pnpm --filter @space-sports/api test:integration` para a API).
- No relatório final, liste: endpoints e `operationId` novos ou alterados, mudanças que quebram, e o que web e mobile precisam ajustar se não estiver no seu escopo (o api-engineer não edita `apps/web` nem `apps/mobile`).
