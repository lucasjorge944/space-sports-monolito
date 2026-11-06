# Space Sports — Plano do Produto

Plataforma para encontrar espaços esportivos perto de você e contratar serviços (aluguel de quadra, aulas, torneios). Foco inicial: quadras de areia em Belo Horizonte/MG.

| Documento | Conteúdo |
|---|---|
| [01-visao-produto.md](01-visao-produto.md) | Visão, personas, proposta de valor, **sugestões de melhoria**, métricas |
| [02-requisitos-funcionais.md](02-requisitos-funcionais.md) | Requisitos e regras de negócio por módulo, matriz de permissões, estados |
| [03-arquitetura.md](03-arquitetura.md) | Arquitetura, stack recomendada, decisões técnicas |
| [04-modelo-de-dados.md](04-modelo-de-dados.md) | Entidades e relacionamentos iniciais |
| [05-design-system.md](05-design-system.md) | Bibliotecas de UI, diretrizes visuais, lista de telas |
| [06-roadmap.md](06-roadmap.md) | Fases, checklists de execução, critérios de saída |
| [07-perguntas-em-aberto.md](07-perguntas-em-aberto.md) | Decisões tomadas e pendentes |
| [08-espacos-parceiros.md](08-espacos-parceiros.md) | Espaços piloto e ficha de implantação |
| [09-infra-aws.md](09-infra-aws.md) | Estado da conta AWS, o que a AWS cobre no projeto e proposta para o ambiente |
| [10-seguranca.md](10-seguranca.md) | Pendências de segurança e o que já foi verificado |
| [11-ia-agentes.md](11-ia-agentes.md) | Proposta de IA e agentes (AG-UI, A2UI, A2A): onde aplicar, arquitetura e fases |
| [12-anuncios.md](12-anuncios.md) | Anúncios de venda direta e o novo Explorar (carrossel, card patrocinado, espaços recentes) |
| [13-pagamentos-online.md](13-pagamentos-online.md) | Pagamento online com split, carteira do espaço, taxa de serviço e pesquisa de mercado |
| [landing-page/CONTEXTO.md](landing-page/CONTEXTO.md) | Contexto autocontido (produto, marca, cores, logos) para a landing page, feita em outro repositório |

## Modelo em uma linha
**SaaS B2B** (implantação + mensalidade por espaço, cobrada fora da plataforma por enquanto), grátis para jogadores; serviços pagos **direto no espaço** ou **online com split** (taxa de serviço paga pelo espaço, decisões 80 a 92). Três frentes: **App** (jogador + modo gestão), **Painel do espaço** e **Painel Super** (plataforma).

## Stack em uma linha
Monorepo **pnpm + Turborepo** · App **Expo (React Native)** · Web **Next.js + shadcn/ui** (`/painel`, `/super`, páginas públicas) · API **NestJS + Drizzle + PostgreSQL/PostGIS + BullMQ/Redis** · UI mobile **NativeWind + React Native Reusables**.

## Status
- [x] Briefing inicial (`../Prompt.md`)
- [x] Plano v1 documentado
- [x] Plano v2: decisões aplicadas (2026-10-23)
- [x] Plano v3: pendências 🔴 respondidas (2026-10-23)
- [ ] Fichas dos espaços parceiros preenchidas
- [ ] Fase 0 iniciada
