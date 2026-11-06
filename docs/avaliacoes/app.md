# Avaliações · mockups do app (AV.1)

Esboços em 360 dp. Medidas, tokens, estados e textos completos em [`05-design-system.md`, "Avaliações"](../05-design-system.md#avaliações). Os dois temas usam os mesmos desenhos: só os tokens trocam (veja [`avaliar-claro-escuro.png`](avaliar-claro-escuro.png)).

Legenda: `[Botão]` primário · `(Botão)` contorno · `‹link›` `ghost`/link · `{Badge}` badge · `[[Chip]]` chip selecionado · `[Chip]` chip · `★` estrela cheia · `☆` vazia · `⯪` meia · `⋮` menu.

## 2. Selo no card da vitrine e no callout do mapa

```
┌──────────────────────────────────────┐
│            foto 4:5                  │   (Patrocinado · …) continua aqui, sobre a foto
├──────────────────────────────────────┤
│ (logo) Arena Beach Savassi           │   nome h4
│        ★ 4,8 (23) · Savassi · 1,2 km │   selo + local (o local encolhe com "…")
│ [Futevôlei] [Beach Tennis]           │
│ ──────────────────────────────────── │
│ R$ 120,00 / hora        Aluguel · Aulas
└──────────────────────────────────────┘

Menos de 5 avaliações:
│        {Novo} · Savassi · 1,2 km     │

Callout do mapa:
┌──────────────────────────────────────┐
│ (logo 48) Arena Beach Savassi        │
│           ★ 4,8 (23) · Savassi · 1,2 km
│           R$ 120,00/h                │
└──────────────────────────────────────┘
```

## 3. Tela de avaliar (`espaco/[slug]/avaliar`)

### 3a. Nova, sem nota

```
┌ ‹  Avaliar ───────────────────────────┐
│ (logo 56) Arena Beach Savassi         │
│           Savassi · Belo Horizonte    │
│                                       │
│ Como foi sua experiência?             │
│      ☆    ☆    ☆    ☆    ☆            │   alvos de 52, encostados
│        Toque para dar a nota          │   muted
│                                       │
│ O que se destacou? (opcional)         │
│ Dê a nota para ver as opções          │   sem chips até escolher a nota
│                                       │
│ Comentário (opcional)                 │
│ ┌───────────────────────────────────┐ │
│ │ Conte como foi o jogo ou a aula   │ │
│ └───────────────────────────────────┘ │
│ Aparece com seu primeiro nome.  0/500 │
├───────────────────────────────────────┤
│ [          Enviar avaliação         ] │   fixo, sobe com o teclado
└───────────────────────────────────────┘
```

### 3b. Nota 4 (positivos) e nota 2 (negativos)

```
│      ★    ★    ★    ★    ☆            │          │      ★    ★    ☆    ☆    ☆            │
│               Bom                     │          │               Ruim                    │
│ O que se destacou? (opcional)         │          │ O que se destacou? (opcional)         │
│ Escolha até 5                         │          │ Escolha até 5                         │
│ [[Quadra boa]] [Bom atendimento]      │          │ [Quadra ruim] [Atendimento ruim]      │
│ [[Limpo]] [Bom custo-benefício]       │          │ [[Sujo]] [Caro] [Difícil de reservar] │
│ [Fácil de reservar] [Boa iluminação]  │          │ [Iluminação ruim] [[Atraso no horário]]
│ [Horário respeitado] [Boa estrutura]  │          │ [Estrutura ruim]                      │
```

Voltar de 2 para 4 devolve "Quadra boa" e "Limpo" marcados; o envio leva só o grupo da nota atual.

### 3c. Sem nota ao enviar · enviando · erro

```
│      ☆    ☆    ☆    ☆    ☆            │   │ [  ◌ Enviando…  ] (desabilitado)  │   ├───────────────────────────────────┤
│ ⓘ Escolha de 1 a 5 estrelas           │   │                                   │   │ ⊗ Sem conexão. Sua avaliação não  │
│   (erro de grupo, input-error-fg)     │   │                                   │   │   foi enviada. Tente de novo.     │
                                                                                     │ [         Enviar avaliação        ] │
```

### 3d. Edição (com aviso de nota salva ou de comentário oculto) e excluir

```
┌ ‹  Avaliar ───────────────────────────┐
│ ┌ ✓ Nota salva. Quer contar mais? ──┐ │   Alert success (vindo do card da reserva)
│ └───────────────────────────────────┘ │
│ ┌ ⓘ Seu comentário está oculto pela ┐ │   Alert info (comentário oculto)
│ │   moderação e não aparece para os │ │
│ │   outros. Editar o texto não o    │ │
│ │   reexibe.                        │ │
│ └───────────────────────────────────┘ │
│ … (formulário preenchido) …           │
│                                       │
│ ‹🗑 Excluir avaliação›                 │   ghost, texto destructive, fim da rolagem
├───────────────────────────────────────┤
│ [         Salvar alterações         ] │
└───────────────────────────────────────┘

Alert nativo:  Excluir sua avaliação?
               A nota sai da média do espaço. Para avaliar de novo, é preciso ter
               jogado ou feito aula aqui nos últimos 6 meses.
               [Cancelar] [Excluir]
```

### 3d'. Só leitura (autor está na equipe do espaço)

```
┌ ‹  Sua avaliação ─────────────────────┐
│ ┌ ⓘ Você faz parte da equipe deste ─┐ │   Alert info
│ │   espaço. Sua avaliação continua  │ │
│ │   publicada, mas não pode ser     │ │
│ │   editada enquanto você estiver   │ │
│ │   na equipe. Você pode excluí-la. │ │
│ └───────────────────────────────────┘ │
│ (logo 56) Arena Beach Savassi         │
│ ★ ★ ★ ★ ☆  Bom                        │   estrelas summary, não tocáveis
│ [Quadra boa] [Limpo]                  │   etiquetas
│ A quadra estava ótima e o pessoal     │
│ foi super atencioso.                  │
├───────────────────────────────────────┤
│ (🗑     Excluir avaliação           ) │   contorno destructive; sem "Salvar"
└───────────────────────────────────────┘
Página do espaço: (Ver minha avaliação) · card da reserva: "Sua avaliação  ‹Ver›" ·
Minhas avaliações: ⋮ só com "Excluir" e "Ver no espaço".
```

### 3e. Sucesso e "não pode avaliar"

```
┌ ‹  Avaliar ───────────────────────────┐   ┌ ‹  Avaliar ───────────────────────────┐
│                                       │   │                                       │
│              ( ✓ )                    │   │   Você pode avaliar depois de jogar   │
│          ★ ★ ★ ★ ☆                    │   │   ou ter aula aqui.                   │
│     Obrigado pela avaliação!          │   │   Vale para reservas e aulas dos      │
│  Ela já aparece na página do Arena    │   │   últimos 6 meses.                    │
│  Beach Savassi.                       │   │                                       │
│                                       │   │          (Ver o espaço)               │
│ [          Ver no espaço            ] │   │                                       │
│ ‹              Fechar               › │   │                                       │
└───────────────────────────────────────┘   └───────────────────────────────────────┘
```

## 4. Card "Avalie sua experiência" (reserva e aula passadas)

```
┌ Reserva ──────────────────────────────┐
│ ┌ Arena Beach Savassi   {Confirmada} ┐│
│ │ Sáb, 01/11/2026 · 18:00–19:00      ││
│ │ Quadra 2 · Futevôlei · 1h · 4 pessoas
│ │ (Ver o espaço)                     ││
│ └────────────────────────────────────┘│
│ ┌ Avalie sua experiência ────────────┐│   logo abaixo do card principal
│ │ Como foi jogar no Arena Beach      ││
│ │ Savassi? Toque numa estrela.       ││
│ │ ☆   ☆   ☆   ☆   ☆                  ││   32 em alvos de 44
│ └────────────────────────────────────┘│
│ ┌ Pagamento ─────────────────────────┐│
```

Toque na 4ª estrela → "Salvando sua nota…" (modo só-criar) → abre a tela de avaliar (3d, com "Nota salva"). Se a API responder 409 `REVIEW_ALREADY_EXISTS`, não navega: o card recarrega e mostra "Sua avaliação" com a nota existente e, por 4 s, "Você já tinha avaliado este espaço.". Depois:

```
│ ┌────────────────────────────────────┐│
│ │ Sua avaliação              ‹Editar›││
│ │ ★ ★ ★ ★ ☆  Bom                     ││
│ └────────────────────────────────────┘│
```

No estado só leitura (equipe), "‹Editar›" vira "‹Ver›".

## 5. Bloco "Avaliações" na página do espaço

Disposição em [`avaliar-claro-escuro.png`](avaliar-claro-escuro.png) (2ª e 4ª telas). Cabeçalho da página:

```
│ (logo 56) Arena Beach Savassi         │
│           Savassi · Belo Horizonte    │
│           ★ 4,8 · 23 avaliações  ›    │   link para o bloco
```

Sem resumo (menos de 5):

```
│ Avaliações                            │
│ ┌───────────────────────────────────┐ │
│ │ {Novo}  Ainda poucas avaliações   │ │
│ │ A nota aparece a partir de 5      │ │
│ │ avaliações.                       │ │
│ └───────────────────────────────────┘ │
│ (        Avaliar este espaço        ) │   só para quem pode avaliar
│ (AS) Ana S. {Jogou aqui}            ⋮ │
│      ★★★★★ · ontem                    │
│      Ótimo lugar!                     │
```

Item, menu aberto (outra pessoa, logado):

```
│ (AS) Ana S. {Jogou aqui}            ⋮ │
│                        ┌──────────────────────┐
│                        │ Denunciar avaliação  │
│                        └──────────────────────┘
```

A minha avaliação na lista (o `id` do item igual a `eligibility.myReview.id`): `{Sua avaliação}` ao lado do nome; menu com "Editar" e "Excluir" (só "Excluir" no estado só leitura). "Denúncia enviada" no menu é estado local da tela, depois do sucesso ou do 409.

Os 3 itens abaixo do resumo são os 3 **comentários** mais recentes (avaliação sem comentário visível não entra). Item editado depois da resposta do espaço: `★★★★☆ · há 3 dias · editada`.

## 6. Ver todas (`espaco/[slug]/avaliacoes`)

```
┌ ‹  Avaliações ────────────────────────┐
│ ★ 4,8 · 23 avaliações                 │
│ [[Todas]] [5 ★ 18] [4 ★ 3] [3 ★ 1] [2…│   rola na horizontal; 0 fica desabilitado
├───────────────────────────────────────┤
│ (item)                                │
│ ───────────────────────────────────── │
│ (item)                                │
│ …                                     │
│                ◌                      │   próxima página
└───────────────────────────────────────┘

Filtro sem resultado:  Nenhuma avaliação com 2 estrelas   (Ver todas)
Erro no fim:           Não foi possível carregar mais.  ‹Tentar de novo›
```

## 9. Denunciar (sheet)

```
┌───────────────────────────────────────┐
│ ▬                                     │
│ Denunciar avaliação                   │
│ A equipe da Space Sports analisa cada │
│ denúncia. A avaliação continua no ar  │
│ enquanto isso.                        │
│ Motivo                                │
│ ◉ Spam ou propaganda                  │
│   Divulga outro negócio ou não tem a  │
│   ver com o espaço                    │
│ ○ Ofensivo ou discriminatório         │
│ ○ Informação falsa                    │
│ ○ Expõe dados pessoais                │
│ ○ Outro motivo                        │
│ Detalhes (opcional)                   │
│ ┌───────────────────────────────────┐ │
│ └───────────────────────────────────┘ │
│                                 0/500 │
│ [          Enviar denúncia          ] │
│ ‹             Cancelar              › │
└───────────────────────────────────────┘
```

## 10. Minhas avaliações (Perfil)

```
┌ ‹  Minhas avaliações ─────────────────┐
│ ┌───────────────────────────────────┐ │
│ │ (logo) Arena Beach Savassi      ⋮ │ │   ⋮: Editar · Excluir · Ver no espaço
│ │        Savassi · Belo Horizonte   │ │
│ │ ★★★★☆ · há 3 dias                 │ │
│ │ [Quadra boa] [Limpo]              │ │
│ │ A quadra estava ótima e o pessoal │ │
│ │ foi super atencioso.              │ │
│ │ ┌ (AB) Resposta do Arena Beach ·  │ │
│ │ │ há 1 dia                        │ │
│ │ │ Valeu, Ana!                     │ │
│ │ └──────────────────────────────── │ │
│ └───────────────────────────────────┘ │
│ ┌───────────────────────────────────┐ │
│ │ (logo) Quadra do Sol            ⋮ │ │
│ │ ★★☆☆☆ · há 2 meses                │ │
│ │ Quadra cheia de buraco.           │ │   comentário oculto: só a autora vê
│ │ ⊘ Oculto pela moderação: só você  │ │
│ │   vê este comentário. A nota      │ │
│ │   continua valendo.               │ │
│ └───────────────────────────────────┘ │
└───────────────────────────────────────┘
```
