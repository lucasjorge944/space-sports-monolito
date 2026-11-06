# 01 · Visão do Produto

## Resumo

**Space Sports** é uma plataforma **SaaS** de gestão para espaços esportivos que também funciona como **vitrine** para jogadores. Do lado do usuário final, um app mobile para descobrir espaços perto de si e contratar serviços (aluguel de quadra, aulas, torneios). Do lado do espaço, um painel web para gerir quadras, agenda, alunos, professores, planos, torneios e recebimentos. Do lado da plataforma, um painel **Super** para gerir espaços, cadastros gerais e acompanhar o uso e os recebimentos registrados.

- **Foco inicial:** quadras de areia em Belo Horizonte/MG (futevôlei, beach tennis, vôlei de praia).
- **Espaços piloto:** Astral Beach Sports, Arena Errejota e Duna Sports (ver [08-espacos-parceiros.md](08-espacos-parceiros.md)).
- **Expansão:** outros esportes e cidades. A modelagem já nasce genérica (esporte, cidade e tipo de quadra são dados, não código).

## Modelo de negócio

- **SaaS B2B:** o espaço paga uma **taxa de implantação** (setup único) e uma **mensalidade recorrente** pelo uso da plataforma. **Por enquanto essa cobrança fica fora da plataforma**: espaço cadastrado já está ativo, com todos os módulos, sem controle de planos, contratos ou faturas.
- **Grátis para o jogador/aluno.**
- **Pagamento dos serviços direto no espaço:** a plataforma **não intermedeia** o dinheiro de reservas, mensalidades de aulas e inscrições de torneio. Ela registra e controla (quem pagou, quem deve, forma de pagamento), e o espaço recebe pelos próprios meios (Pix, cartão na maquininha, dinheiro).
- **Pagamento online (decisões 80 a 92, `13-pagamentos-online.md`):** o espaço pode ativar Pix e cartão pelo app em reservas e mensalidades de aulas. O gateway divide cada pagamento (*split*): o espaço recebe na própria subconta e a plataforma fica com a **taxa de serviço, paga pelo espaço** (padrão Pix 4% / cartão 6%, mínimo R$ 1,00). A plataforma não guarda saldo, e o jogador não tem saldo pré-pago. Pagar no local continua existindo. É a segunda fonte de receita, ao lado do SaaS.

## Personas

| Persona | Onde usa | O que quer |
|---|---|---|
| **Jogador / Aluno** | App mobile | Achar quadra perto, reservar rápido, dividir com a galera, entrar em aulas e torneios |
| **Dono / Admin do espaço** | Web (e app, só leitura) | Encher a agenda, controlar mensalidades sem planilha, reduzir trabalho no WhatsApp |
| **Professor** | Web (e app, só leitura) | Ver suas turmas, abrir/fechar listas de presença, saber quem vem |
| **Super (admin da plataforma)** | Web – painel Super | Gerir espaços, cadastros, suporte, métricas e visão consolidada de recebimentos |

## Proposta de valor

- **Jogador:** "Encontre e reserve sua quadra de areia em BH em 30 segundos e divida com a galera."
- **Espaço:** "Pare de gerir agenda, mensalidades e torneios por planilha e WhatsApp."

## Problemas que o produto resolve

1. A descoberta de espaços é fragmentada (Instagram, indicação, Google Maps).
2. A reserva de quadra é feita por WhatsApp, com idas e vindas.
3. O controle de alunos, planos e presença fica em planilha, o que gera inadimplência e turmas lotadas ou vazias.
4. Os torneios são organizados manualmente (inscrições por formulário, chaveamento em papel/Excel).

---

## Decisões de produto aplicadas (v2 · 2026-10-23)

| Tema | Decisão |
|---|---|
| Preço do aluguel | Cada espaço define o **preço por hora**. O valor é proporcional, em **frações de 30 min** (ex.: R$ 100/h → 1h30 = R$ 150). |
| Aprovação de reservas | **Não há.** A reserva avulsa é confirmada na hora. |
| Mensalista | Paga um **valor mensal fixo definido pelo espaço**. |
| Cancelamento | O espaço define um **prazo de cancelamento** (ex.: até 1h antes do início). Depois do prazo, o cancelamento pelo app fica bloqueado. |
| Pagamento | **Direto no espaço** ou, se o espaço ativar, **online pelo app** (Pix/cartão, com split e taxa paga pelo espaço; decisões 80 a 92). |
| Lista de presença | O espaço configura o modo: **automático** (abre X horas antes e fecha Y minutos antes) ou **manual** (Admin/Professor abre e fecha). Há **lista de espera**. |
| Aulas | O plano dá direito a **turmas fixas** cadastradas pelo espaço (ex.: 2x/semana = aluno matriculado em 2 turmas fixas). No **ilimitado**, o aluno vai quantas vezes quiser nas turmas em que foi matriculado. |
| Torneios | **Categorias** (gênero/nível) e **inscrição em dupla**. |
| Aluguel social | **Dividir a conta** entre os jogadores e **horário fixo semanal (mensalista)**. |
| Papéis | Uma pessoa pode ter **papéis diferentes em espaços diferentes**: Dono, Admin, Professor. |
| Plataforma | **Painel Super** para gerir espaços e cadastros. A cobrança do SaaS (planos, implantação, mensalidade) **não será controlada por enquanto**. |
| Time/prazo | Não definidos. O roadmap não tem estimativas de duração. |

## Outras recomendações (backlog)

- **Controle de no-show:** como não há aprovação e o pagamento é no local, marcar as faltas e, depois de N faltas, bloquear novas reservas desse jogador pelo app.
- **Cobrança do SaaS na plataforma:** planos, contratos, faturas, NFS-e e régua de cobrança.
- **Preço diferenciado por quadra ou horário nobre** (evolução do preço por hora único).
- **Reposição de aula** e **aula experimental**.
- **Placar ao vivo** e chave pública compartilhável dos torneios.
- **Avaliações** de espaços, **favoritos**, feed de novidades dos espaços.
- **Check-in por QR Code**.
- **Integração Wellhub/Gympass e TotalPass**.
- **Lembretes por WhatsApp**.
- **LGPD:** termos, privacidade, consentimento e exclusão de conta (exigida pelas lojas).

---

## Métricas de sucesso

- **North Star:** nº de reservas + presenças confirmadas por semana na plataforma.
- **Produto:** espaços ativos, % da agenda ocupada via app, MAU de jogadores, conversão de visualização do espaço → reserva, retenção D30.
- **Espaços:** nº de espaços ativos, tempo de implantação, uso semanal do painel por espaço.
