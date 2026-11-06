# 03 · Arquitetura e Stack

## Princípios

1. **TypeScript ponta a ponta**: um time pequeno consegue trabalhar em mobile, web e backend com a mesma linguagem e compartilhar tipos/validações.
2. **Monólito modular** no backend: um único deploy, com módulos bem separados (Auth, Spaces, Booking, Classes, Tournaments, PaymentRecords, Notifications, Super). Microsserviços só se e quando houver necessidade real.
3. **Monorepo** para compartilhar código (schemas, tipos, cliente da API, tokens de design).
4. **Serviços gerenciados** para o que não é diferencial (auth social/OTP, pagamentos, storage, push, e-mail).
5. **Multi-tenant por coluna** (`space_id`) com checagem de permissão centralizada.

## Visão geral

```
                ┌──────────────────────┐      ┌───────────────────────┐
                │  App Mobile (Expo)   │      │  Web (Next.js)        │
                │  Jogador / Gestão    │      │  /painel  (espaço)    │
                │  iOS + Android       │      │  /super   (plataforma)│
                │                      │      │  páginas públicas     │
                └──────────┬───────────┘      └───────────┬───────────┘
                           │  HTTPS / REST (OpenAPI, cliente tipado)  │
                           └───────────────┬──────────────────────────┘
                                           ▼
                          ┌─────────────────────────────────┐
                          │      API – NestJS (monólito     │
                          │      modular, TypeScript)       │
                          │  Auth · Spaces · Booking ·      │
                          │  Classes · Tournaments ·        │
                          │  PaymentRecords · Notifications │
                          │  Super (espaços, catálogos)     │
                          └──┬─────────┬─────────┬──────────┘
                             │         │         │
               ┌─────────────▼──┐  ┌───▼─────┐ ┌─▼──────────────────┐
               │ PostgreSQL 17  │  │ Redis   │ │ Workers (BullMQ)   │
               │ + PostGIS      │  │ cache / │ │ abrir/fechar listas│
               │ (Drizzle ORM)  │  │ filas   │ │ gerar sessões e    │
               └────────────────┘  └─────────┘ │ mensalistas, mens- │
                                               │ alidades, pushes   │
                                               └────────────────────┘
   Externos: Expo Push · Resend (e-mail) · S3 + CloudFront (fotos)
             Google Maps Platform · Sentry · PostHog
```

---

## Stack recomendada

### Monorepo
| Item | Escolha | Por quê |
|---|---|---|
| Gerenciador | **pnpm** workspaces | Rápido, bom suporte a monorepo |
| Orquestração | **Turborepo** | Cache de build/test, pipelines simples |
| Qualidade | **Biome** (lint+format) ou ESLint+Prettier, **TypeScript strict** | Padronização |
| Validação compartilhada | **Zod** | Mesmo schema no app, web e API |

```
space-sports/
├── apps/
│   ├── mobile/          # Expo (React Native)
│   ├── web/             # Next.js – painel + páginas públicas
│   └── api/             # NestJS – API + workers
├── packages/
│   ├── shared/          # schemas Zod, enums, regras puras (ex.: cálculo de preço)
│   ├── api-client/      # cliente gerado do OpenAPI (orval) + hooks TanStack Query
│   ├── ui-tokens/       # cores, tipografia, espaçamentos (Tailwind preset)
│   └── config/          # tsconfig, biome/eslint, tailwind base
├── docs/
└── turbo.json
```

### Mobile
| Item | Escolha |
|---|---|
| Framework | **React Native + Expo** (SDK mais recente, New Architecture) |
| Navegação | **Expo Router** (rotas por arquivo, deep links prontos) |
| Build/loja | **EAS Build + EAS Submit**; **EAS Update** para correções OTA |
| Dados/servidor | **TanStack Query** (cache, retry, offline básico) |
| Estado local | **Zustand** |
| Formulários | **React Hook Form + Zod** |
| Listas (vitrine) | **@shopify/flash-list** |
| Imagens | **expo-image** (cache, blurhash) |
| Mapas | **react-native-maps** (Google no Android / Apple Maps no iOS) |
| Localização | **expo-location** |
| Push | **expo-notifications** |
| Compartilhar | Convites de dividir conta/dupla via `expo-sharing` + deep link (WhatsApp) |

> Por que Expo e não Flutter/nativo: o mesmo time TS faz app e web, as atualizações OTA reduzem a dependência de revisão das lojas, e o ecossistema (mapas, push, câmera para QR) está maduro. Como o app não processa pagamentos (o pagamento é no espaço), não há exigência de compra in-app nem integração de pagamento no mobile.

### Web (painel do espaço + Super + público)
| Item | Escolha |
|---|---|
| Framework | **Next.js** (App Router) com três áreas: `/(public)` páginas com SEO (espaço, torneio/chave), `/painel` (gestão do espaço, contexto `spaceId`) e `/super` (plataforma, papel `SUPER`), cada uma com seu layout e middleware de acesso |
| Dados | **TanStack Query** + cliente gerado (`packages/api-client`) |
| Tabelas | **TanStack Table** |
| Formulários | **React Hook Form + Zod** |
| Agenda/calendário | **FullCalendar** (visão por recurso = quadras) ou **Schedule-X** |
| Chaveamento | **brackets-manager.js** (lógica) + **brackets-viewer.js** (render) ou componente próprio |
| Gráficos | **Recharts** (via shadcn/ui charts) |

### Backend
| Item | Escolha | Observação |
|---|---|---|
| Framework | **NestJS** (Node 22 LTS) | Estrutura modular, DI, guards de permissão, OpenAPI automático |
| ORM | **Drizzle ORM** + drizzle-kit (migrações) | SQL explícito, bom suporte a tipos PostGIS e ranges |
| Banco | **PostgreSQL 17 + PostGIS** | Geobusca (`ST_DWithin`), `EXCLUDE USING gist` contra dupla reserva |
| Filas/Jobs | **BullMQ + Redis** | Expirar reservas pendentes, gerar sessões, abrir/fechar listas, cobranças, notificações |
| Auth | **Better Auth** (self-hosted, e-mail, Google, Apple, OTP por telefone) | Alternativa gerenciada: Clerk ou Supabase Auth |
| Documentação | OpenAPI (Swagger) → **orval** gera o cliente tipado |
| Upload | URLs pré-assinadas para o **Amazon S3**, servidas pelo **CloudFront** (decisão 72; `docs/09-infra-aws.md`, seção 8) + redimensionamento |
| E-mail | **Resend** + React Email |
| SMS/WhatsApp OTP | Twilio / Zenvia (avaliar custo) |

### Pagamentos
**Serviços (reserva, mensalidade de aula, inscrição):** são pagos **direto no espaço**. A plataforma não integra gateway para isso; ela só guarda **registros de pagamento** lançados pela gestão (módulo `PaymentRecords`). Isso elimina, no início, a complexidade de split, webhooks de jogador, reembolsos e PCI.

**SaaS (plataforma cobrando os espaços):** **fora do escopo por enquanto**. Espaço cadastrado já fica ativo, com todos os módulos, sem controle de planos, contratos ou faturas na plataforma. Quando entrar (backlog), usar um gateway com assinatura recorrente B2B, boleto/Pix/cartão e NFS-e. A recomendação é o **Asaas** (alternativas: Iugu, Stripe Billing), atrás de uma interface `BillingGateway`.

Se no futuro os espaços quiserem receber online, criar um adapter `PaymentGateway` com subcontas por espaço.

### Infraestrutura
| Fase | Escolha |
|---|---|
| Hospedagem | **AWS** em todos os ambientes hospedados (decisão 55): API, workers, web, Postgres com PostGIS e Redis. Uma instância EC2 em `sa-east-1` com os serviços em Docker e RDS para o Postgres (decisão 56; detalhes em `09-infra-aws.md`). Se o volume justificar: ECS Fargate, ALB e ElastiCache |
| CI/CD | **GitHub Actions** (lint, typecheck, testes, preview deploys, EAS build) |
| Observabilidade | **Sentry** (erros, mobile+web+api), logs estruturados (pino), **PostHog** (analytics de produto, feature flags) |
| Ambientes | `dev` (local com Docker Compose), `staging`, `production` |

### Testes
| Camada | Ferramenta |
|---|---|
| Unitário (regras puras, ex.: preço proporcional, disponibilidade, lista de presença, chaveamento) | **Vitest** |
| Integração API (com Postgres real) | Vitest + **Testcontainers** |
| E2E web | **Playwright** |
| E2E mobile | **Maestro** |

---

## Decisões técnicas importantes

1. **Anti-dupla-reserva no banco:** tabela `court_occupations` com `tstzrange` e `EXCLUDE USING gist (court_id WITH =, period WITH &&)` filtrando status ativos. Reservas, sessões de aula, partidas de torneio e bloqueios manuais escrevem nessa tabela — a agenda tem uma única fonte da verdade. A agenda do professor entre espaços segue o mesmo desenho em `teacher_occupations` (RN-CLASS-09).
2. **Geobusca:** coluna `location geography(Point)` com índice GiST; ordenação por `ST_Distance`. Paginação por cursor na vitrine.
3. **Datas:** tudo em UTC no banco (`timestamptz`); conversão para `America/Sao_Paulo` na borda.
4. **Dinheiro:** inteiro em centavos; o cálculo de preço `price_per_hour_cents × minutos ÷ 60` (arredondado) fica em `packages/shared`. É a mesma função no app (pré-visualização) e na API (a API sempre recalcula).
5. **Autorização:** dois níveis. (a) Plataforma: `users.platform_role = SUPER`. (b) Espaço: um guard do NestJS que resolve `(userId, spaceId) → papel` e verifica a matriz de `02-requisitos-funcionais.md`. Todas as queries de gestão filtram por `space_id`.
6. **Jobs agendados** (BullMQ repeatable):
   - gerar as sessões de aula das próximas 4 semanas (diário);
   - gerar as reservas de mensalistas das próximas 4 semanas (diário);
   - abrir/fechar as listas de presença no modo automático (1/min);
   - gerar as mensalidades de alunos e de mensalistas e marcar atrasos (diário);
   - lembretes (reserva, aula, mensalidade);
   - pedidos de avaliação ~2 h depois da reserva ou aula (a cada 5 min, fila `notification-schedules`, RN-REVIEW-02);
   - apagar os recibos vencidos dos eventos de anúncios (diário, fila `ads-maintenance`).
7. **Auditoria:** tabela `audit_logs` para ações sensíveis (abrir/fechar lista, cancelar, registrar/estornar pagamento, sorteio, modo suporte do Super).
8. **Feature flags** (PostHog) para liberar funcionalidades gradualmente.

## Alternativa mais enxuta (se o time for 1–2 pessoas)
**Supabase** (Postgres + PostGIS + Auth + Storage + Edge Functions) no lugar de NestJS/Better Auth/R2. Entrega mais rápido no início, mas regras complexas (listas de presença, mensalistas, chaveamento) ficam espalhadas entre RLS, funções SQL e edge functions. Recomendo a stack principal pela complexidade de regras do produto.
