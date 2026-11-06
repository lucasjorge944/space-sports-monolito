# Avaliações · mockups do web (AV.1)

Página pública, painel do espaço e Super. Medidas, tokens, estados e textos completos em [`05-design-system.md`, "Avaliações"](../05-design-system.md#avaliações). Mesma legenda de [`app.md`](app.md).

## 5. Página pública do espaço (`/espacos/<slug>`), ≥ 1024 px

```
┌ (logo 72) Arena Beach Savassi                                   [ Abrir no app ] ┐
│           ⌖ Rua …, Savassi · Belo Horizonte                                       │
│           ★ 4,8 · 23 avaliações                    (link para #avaliacoes)        │
│           [Futevôlei] [Beach Tennis]                                              │
├───────────────────────────────────────────────────────────────────────────────────┤
│ fotos                                                                             │
├──────────────────────────────────────────────────────┬────────────────────────────┤
│ Sobre o espaço · Quadras · Infraestrutura             │ Alugar quadra              │
│                                                      │ Funcionamento              │
│ Avaliações                              (h2 text-h3) │ Contato e localização      │
│ ┌──────────────────────────────────────────────────┐ │                            │
│ │  4,8          5 ★ ████████████████████░░░  18    │ │                            │
│ │  ★★★★★        4 ★ ████░░░░░░░░░░░░░░░░░░░   3    │ │                            │
│ │  23 avaliações 3 ★ █░░░░░░░░░░░░░░░░░░░░░   1    │ │                            │
│ │  (coluna 160) 2 ★ ░░░░░░░░░░░░░░░░░░░░░░░   0    │ │                            │
│ │               1 ★ █░░░░░░░░░░░░░░░░░░░░░░   1    │ │                            │
│ │ ─────────────────────────────────────────────── │ │                            │
│ │ MAIS CITADOS  [👍 Quadra boa 12] [👍 Limpo 9] [👎 Caro 4]                        │
│ └──────────────────────────────────────────────────┘ │                            │
│ Jogou aqui? Avalie ‹pelo app›.                        │                            │
│                                                      │                            │
│ (AS) Ana S. {Jogou aqui}                          ⋮  │   ⋮ só com sessão no web:  │
│                                                      │   só "Denunciar"           │
│      ★★★★☆ · há 3 dias                               │                            │
│      [Quadra boa] [Limpo]                            │                            │
│      A quadra estava ótima e o pessoal foi super     │                            │
│      atencioso. Voltaremos!                          │                            │
│      ┌ (AB) Resposta do Arena Beach · há 1 dia ────┐ │                            │
│      │ Valeu, Ana! Esperamos vocês de novo.        │ │                            │
│      └─────────────────────────────────────────────┘ │                            │
│ ──────────────────────────────────────────────────── │                            │
│ (item) · (item)   ← 3 comentários mais recentes      │                            │
│ ‹Ver todas as 23 avaliações ››                       │                            │
└──────────────────────────────────────────────────────┴────────────────────────────┘
```

Abaixo de 640 px, o resumo fica empilhado como no app. Sem resumo: o card "{Novo} Ainda poucas avaliações" de [`app.md`](app.md#5-bloco-avaliações-na-página-do-espaço).

## 6. Ver todas (`/espacos/<slug>/avaliacoes`)

```
‹ Arena Beach Savassi
Avaliações de Arena Beach Savassi                       (h1 text-h2)
(resumo do bloco 5)
[[Todas]] [5 ★ 18] [4 ★ 3] [3 ★ 1] [2 ★ 0] [1 ★ 1]     links ?nota=N; 0 desabilitado
(item) ─ (item) ─ … (20)
(        Carregar mais avaliações        )               <a href="?nota=&cursor=…">, com JS acrescenta
```

Páginas com `?cursor=`: `noindex, follow` e `canonical` para `/espacos/<slug>/avaliacoes`.

## 7. Painel `/painel/avaliacoes`

```
┌ sidebar ┬─────────────────────────────────────────────────────────────────────────────┐
│ …       │ Avaliações                                                                  │
│ Gestão  │ O que jogadores e alunos dizem do Arena Beach Savassi. As respostas são     │
│  …      │ públicas.                                                                   │
│  Contatos│                                                                            │
│ ▸Avaliações ┌ Média ─────────────┐ ┌ Total ─────────────┐ ┌ Últimos 90 dias ─────────┐ │
│  Espaço │ │ 4,8  ★★★★★          │ │ 23                 │ │ 4,6                      │ │
│  Equipe │ │ Aparece no app e no │ │ ‹5 sem resposta›   │ │ 12 avaliações · geral 4,8│ │
│         │ │ site               │ │                    │ │ ▁ ▆ ▇ ─ █ ▇ ▆ ─ █ █ ▇ █ ▆ │ │   uma coluna por ponto semanal da API
│         │ └────────────────────┘ └────────────────────┘ └──────────────────────────┘ │
│         │ ┌ Notas ──────────────────────────┐ ┌ Destaques ─────────────────────────┐ │
│         │ │ 5 ★ ████████████████░░  18 · 78% │ │ 👍 Elogios          👎 Críticas    │ │
│         │ │ 4 ★ ███░░░░░░░░░░░░░░░   3 · 13% │ │ Quadra boa     12  Caro          4 │ │
│         │ │ 3 ★ █░░░░░░░░░░░░░░░░░   1 ·  4% │ │ Limpo           9  Atraso no h…  2 │ │
│         │ │ 2 ★ ░░░░░░░░░░░░░░░░░░   0 ·  0% │ │ Bom atendim…    7  Sujo          1 │ │
│         │ │ 1 ★ █░░░░░░░░░░░░░░░░░   1 ·  4% │ │ …                                  │ │
│         │ └──────────────────────────────────┘ └────────────────────────────────────┘ │
│         │ ┌──────────────────────────────────────────────────────────────────────────┐ │
│         │ │ Nota [Todas ⌄]  [Sem resposta]                          23 avaliações    │ │
│         │ │ ──────────────────────────────────────────────────────────────────────── │ │
│         │ │ (AS) Ana S. {Jogou aqui}  ★★★★☆ · há 3 dias                           ⋮  │ │
│         │ │      [Quadra boa] [Limpo]                                                │ │
│         │ │      A quadra estava ótima e o pessoal foi super atencioso. Voltaremos!  │ │
│         │ │      ┌ (AB) Resposta do Arena Beach · há 1 dia ───────────────────────┐  │ │
│         │ │      │ Valeu, Ana! Esperamos vocês de novo.                           │  │ │
│         │ │      └────────────────────────────────────────────────────────────────┘  │ │
│         │ │      ‹Editar resposta›  ‹Remover resposta›                               │ │
│         │ │ ──────────────────────────────────────────────────────────────────────── │ │
│         │ │ (JP) João P. {Aluno}  ★★☆☆☆ · ontem                                   ⋮  │ │
│         │ │      [Caro] [Atraso no horário]                                          │ │
│         │ │      A aula começou 20 min atrasada.                                     │ │
│         │ │      ┌ (AB) Responder como Arena Beach Savassi ───────────────────────┐  │ │
│         │ │      │ ┌──────────────────────────────────────────────────────────┐   │  │ │
│         │ │      │ │ Desculpe pelo atraso, João. Já ajustamos a agenda do …   │   │  │ │
│         │ │      │ └──────────────────────────────────────────────────────────┘   │  │ │
│         │ │      │ A resposta é pública e aparece com o nome do espaço.   58/500  │  │ │
│         │ │      │                              ‹Cancelar›  [Publicar resposta]   │  │ │
│         │ │      └────────────────────────────────────────────────────────────────┘  │ │
│         │ │ ──────────────────────────────────────────────────────────────────────── │ │
│         │ │ (item sem resposta)                                     (Responder)      │ │
│         │ │                         (Carregar mais)                                  │ │
│         │ └──────────────────────────────────────────────────────────────────────────┘ │
└─────────┴─────────────────────────────────────────────────────────────────────────────┘
```

Professor: a mesma página, sem "Responder", "Editar/Remover resposta" e sem `⋮`, com o `Alert` `info` no topo: "Você vê as avaliações do espaço. Só o Dono e os Administradores respondem."

Menos de 5 avaliações, card Média: "4,3 ★★★★⯪" e "Aparece no app a partir de 5 avaliações (faltam 2)".

## 8. Super

### Fila de denúncias (`/super/avaliacoes`)

```
Avaliações
[ Abertas | Resolvidas | Descartadas ]
┌──────────────┬──────────────────┬──────────────────────────────┬─────────────────────┬──────────────┬──────────┐
│ Recebida     │ Espaço           │ Avaliação                    │ Motivo              │ Denunciante  │ Status   │
├──────────────┼──────────────────┼──────────────────────────────┼─────────────────────┼──────────────┼──────────┤
│ 04/11 14:02  │ Arena Beach Sav… │ ★☆☆☆☆ "Esse lugar é uma …"   │ Ofensivo ou discr…  │ Espaço · Arena│ {Aberta} │
│ 03/11 21:40  │ Quadra do Sol    │ ★★☆☆☆ "Liga pro 31 9…"       │ Expõe dados pess… ✎ │ Maria L.     │ {Aberta} │
└──────────────┴──────────────────┴──────────────────────────────┴─────────────────────┴──────────────┴──────────┘
                                         (Carregar mais)
```

### Detalhe (`/super/avaliacoes/<id>`)

```
‹ Avaliações
Avaliação de Rafael Martins no Quadra do Sol            (Ocultar comentário)   ← contorno, texto destructive
┌ Avaliação ─────────────────────────────┐ ┌ Denúncias ───────────────────────────────┐
│ (RM) Rafael M. {Aluno}  ★★☆☆☆          │
│ {⊘ Autor bloqueado · fora da média}    │   só se author.blocked / counted falso │ Expõe dados pessoais · Maria L.          │
│ Rafael Martins (link para o usuário)   │ │ 03/11/2026 21:40 · {Aberta}  ‹Descartar› │
│ Criada 01/11/2026 · editada 02/11/2026 │ │ "Tem o telefone de uma pessoa."          │
│ [Sujo]                                 │ │ ──────────────────────────────────────── │
│ Liga pro 31 9…  (comentário completo)  │ │ Spam ou propaganda · João P. {Descartada}│
│ Espaço: Quadra do Sol ›                │ └──────────────────────────────────────────┘
└────────────────────────────────────────┘ ┌ Histórico de moderação ──────────────────┐
                                           │ • Denúncia descartada por Lucas ·        │
                                           │   02/11/2026 10:12                        │
                                           └──────────────────────────────────────────┘

Diálogo:  Ocultar o comentário?
          A nota e os chips continuam valendo. As denúncias abertas desta avaliação são resolvidas.
          Motivo
          ┌───────────────────────────────────────────────────┐
          │ Expõe o telefone de terceiros.                    │
          └───────────────────────────────────────────────────┘
          Fica na auditoria; o autor não vê.           31/500
                                   ‹Cancelar›  [Ocultar comentário]
```

### Avaliações por espaço (`/super/espacos/<id>/avaliacoes`)

Os indicadores e a lista do painel (7), com o filtro a mais `[Com comentário oculto]`, o selo `{2 denúncias abertas}` (warning) no item e o link "Moderar ›" para o detalhe. Responder só pelo modo suporte.
