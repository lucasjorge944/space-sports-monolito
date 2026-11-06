# 10 · Segurança

Pendências encontradas na verificação do staging em 2026-11-02, para corrigir depois. Foi uma checagem rápida do ambiente, da conta AWS, das dependências e da exposição de chaves. Não foi um pentest nem uma revisão de todo o código.

## 1. Pendências

### Alta
- [ ] **Documentação da API pública.** `/docs` e `/docs-json` respondem sem login em `api-staging` e mostram todas as rotas (`apps/api/src/app.setup.ts`). Desligar em `production`, sem quebrar o export do OpenAPI usado pelo `api-client`.
- [ ] **Cabeçalhos de segurança ausentes.** Não há HSTS, CSP, `X-Frame-Options` nem `X-Content-Type-Options` na API e no web. Adicionar no Caddy (`infra/staging/Caddyfile`) e no Next, e remover o `x-powered-by`.
- [ ] **`multer` 2.4.0 na API.** Falha de negação de serviço, vinda de `@nestjs/platform-express`. Atualizar para 2.5.0 ou superior.

### Média
- [ ] **Pré-sequestro pelo link de verificação de e-mail** (achado na revisão da C.2, 2026-11-03). Alguém cadastra com senha o e-mail de outra pessoa; se a dona clicar no link "Confirme seu e-mail", a senha de quem cadastrou continua valendo, e os contatos daquele e-mail passam a ser vinculados a essa conta (RF-CONTACT-04). A RN-AUTH-06 fecha o mesmo caso no login com Google, mas não neste caminho. Correção provável: ao verificar o e-mail de uma conta cuja senha foi criada antes da verificação, pedir a redefinição de senha ou revogar a senha e as sessões, como no Google.
- [ ] **Rastro de auditoria na AWS.** Não há CloudTrail nem GuardDuty em `sa-east-1`. Criar um trail na organização e avaliar o custo do GuardDuty.
- [ ] **Dependências do app.** `node-forge` 1.4.0 e `zod` 3.25.76 têm alertas altos, vindos de `expo-notifications`. Conferir se chegam ao app e atualizar o Expo.
- [ ] **Demais alertas de dependências.** `pnpm audit --prod` apontou 18 alertas (8 altos, 6 moderados e 4 baixos). Só os altos foram analisados.
- [ ] **Root da conta-membro.** A conta `123456789012` está sem MFA na root. Confirmar que não há senha definida; ativar o MFA se ela for usada, ou restringir por SCP.
- [ ] **Busca de chaves automatizada.** `gitleaks` e `trufflehog` não estão instalados. Colocar o `gitleaks` na CI e no pre-commit.

### Antes de production
- [ ] **Revisão de segurança dedicada,** ou pentest, cobrindo isolamento entre espaços, permissões por papel e uploads. Essas áreas não entraram nesta verificação.
- [ ] **Banco:** RDS com backups automáticos e TLS verificado (seção "Pontos para a tarefa de deploy" de `docs/tarefas/staging.md`).
- [ ] **WAF e monitoramento:** decidir se entram no lançamento. O staging não tem WAF, nem alarmes, e roda num servidor único.
- [ ] **Conferir as camadas das imagens no ECR.** A revisão da S.2 verificou o Dockerfile e o contexto de build, mas a imagem publicada não foi varrida.

## 2. O que passou na verificação

- Na rede, só 80 e 443 respondem; SSH, API, Postgres e Redis estão fechados para a internet.
- HTTPS com certificado válido, e HTTP redireciona para HTTPS.
- Rotas protegidas respondem 401 sem sessão, e o login bloqueia com 429 a partir da 4ª tentativa errada.
- O CORS não autorizou uma origem externa de teste.
- A instância usa IMDSv2 obrigatório, com limite de 1 salto, e disco criptografado.
- Segredos no Parameter Store como `SecureString`, fora do user data, do template e dos logs do deploy.
- A conta de gerenciamento tem MFA na root e nenhuma chave de acesso de root.
- Nenhuma chave real no histórico do git (365 commits, por padrões conhecidos), no JavaScript público nem em `/.env` e `/.git/config`.

## 3. Regras

- Chave nunca vai para código, chat, issue ou log. Grave no Parameter Store com `read -rs` no terminal.
- Chave exposta é apagada e trocada, mesmo que pareça não ter sido usada.
