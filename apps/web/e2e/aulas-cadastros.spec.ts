import { expect, type Page, test } from './fixtures';
import { loginAs, mockCalls } from './helpers';

// Cada teste tem o seu escopo na API simulada (e2e/fixtures.ts): o registro de chamadas não é dividido
// com os testes que rodam em paralelo.

/** Abre o seletor (Radix) pelo `id` do gatilho e escolhe a opção pelo nome. */
async function pick(page: Page, triggerId: string, option: string) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Escolhe um professor na seleção múltipla do formulário. */
async function toggleTeacher(page: Page, name: string) {
  await page
    .getByRole('dialog')
    .getByRole('group', { name: 'Professores' })
    .getByRole('button', { name })
    .click();
}

async function openAdvancedEditor(page: Page) {
  await page
    .getByTestId('class-group-row')
    .filter({ hasText: 'Futevôlei Avançado' })
    .getByRole('button', { name: 'Editar Futevôlei Avançado' })
    .click();
}

test.describe('turmas', () => {
  test('lista as turmas com horário, vagas e situação', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/turmas');
    await expect(page.getByRole('heading', { name: 'Turmas' })).toBeVisible();
    const rows = page.getByTestId('class-group-row');
    await expect(rows).toHaveCount(3);

    const beginner = rows.filter({ hasText: 'Futevôlei Iniciante' });
    await expect(beginner).toContainText('Paulo Professor');
    await expect(beginner).toContainText('Quadra 1');
    await expect(beginner).toContainText('Ter · 19:00–20:00');
    await expect(beginner).toContainText('4/12 matriculados');
    await expect(beginner).toContainText('8 vagas');
    await expect(beginner).toContainText('Ativa');

    const advanced = rows.filter({ hasText: 'Futevôlei Avançado' });
    await expect(advanced).toContainText('Qui · 20:00–21:30');
    await expect(advanced).toContainText('Lotada');

    await expect(rows.filter({ hasText: 'Futevôlei Manhã' })).toContainText('Inativa');
  });

  test('avisa das aulas que o job não conseguiu gerar', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/turmas');
    const notice = page.getByTestId('class-conflicts');
    await expect(notice).toContainText('1 aula não foi gerada');
    // 22:00Z = 19:00 em São Paulo.
    await expect(notice).toContainText('03/11/2026, 19:00');
    await expect(notice).toContainText('um bloqueio da quadra');
  });

  test('filtra por situação', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/turmas');
    await page.getByLabel('Filtrar por situação').click();
    await page.getByRole('option', { name: 'Inativas' }).click();
    await expect(page.getByTestId('class-group-row')).toHaveCount(1);
    await expect(page.getByTestId('class-group-row')).toContainText('Futevôlei Manhã');
  });

  test('cria a turma enviando os campos no contrato da API', async ({ page, context, request }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/turmas');
    await page.getByRole('button', { name: 'Nova turma' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nome').fill('Turma Criada E2E');
    await pick(page, 'cg-court', 'Quadra 1');
    await pick(page, 'cg-sport', 'Futevôlei');
    await toggleTeacher(page, 'Lia Admin');
    await toggleTeacher(page, 'Paulo Professor');
    await pick(page, 'cg-level', 'Intermediário');
    await pick(page, 'cg-weekday', 'Quarta');
    await pick(page, 'cg-start', '18:30');
    await pick(page, 'cg-duration', '1h30');
    await dialog.getByLabel('Capacidade (alunos)').fill('10');
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Turma criada.')).toBeVisible();

    const call = (await mockCalls(request)).find(
      (c) => c.path.endsWith('/class-groups') && c.body.name === 'Turma Criada E2E',
    );
    expect(call?.path.startsWith('POST ')).toBe(true);
    expect(call?.body).toMatchObject({
      level: 'INTERMEDIATE',
      teacherMemberIds: [ID(1052), ID(1051)],
      weekday: 3,
      startTime: '18:30',
      durationMin: 90,
      capacity: 10,
      active: true,
    });
  });

  test('valida os campos antes de chamar a API', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/turmas');
    await page.getByRole('button', { name: 'Nova turma' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(dialog.getByText('Informe o nome da turma')).toBeVisible();
    await expect(dialog.getByText('Escolha a quadra', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Escolha ao menos um professor')).toBeVisible();
    await expect(dialog.getByText('De 1 a 100 alunos')).toBeVisible();
  });

  test('conflito de agenda aparece por código, com o que conflita', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/turmas');
    await page.getByRole('button', { name: 'Nova turma' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nome').fill('Conflito');
    await pick(page, 'cg-court', 'Quadra 1');
    await pick(page, 'cg-sport', 'Futevôlei');
    await toggleTeacher(page, 'Paulo Professor');
    await dialog.getByLabel('Capacidade (alunos)').fill('8');
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(
      dialog.getByText(
        'O horário conflita com uma reserva em 04/11/2026, 19:00. Escolha outro dia, horário ou quadra.',
      ),
    ).toBeVisible();
  });

  test('conflito de professor explica o horário e não cita o outro espaço', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/turmas');
    await page.getByRole('button', { name: 'Nova turma' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nome').fill('Conflito de professor');
    await pick(page, 'cg-court', 'Quadra 1');
    await pick(page, 'cg-sport', 'Futevôlei');
    await toggleTeacher(page, 'Lia Admin');
    await dialog.getByLabel('Capacidade (alunos)').fill('8');
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(
      dialog.getByText(
        'Lia Admin já tem aula em outro espaço em 04/11/2026, 19:00 às 20:00. Escolha outro horário ou professor.',
      ),
    ).toBeVisible();
  });

  test('turma com dois professores aparece com os dois e abre o formulário marcado', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/turmas');
    const row = page.getByTestId('class-group-row').filter({ hasText: 'Futevôlei Manhã' });
    await expect(row).toContainText('Paulo Professor, Lia Admin');

    await row.getByRole('button', { name: 'Editar Futevôlei Manhã' }).click();
    const group = page.getByRole('dialog').getByRole('group', { name: 'Professores' });
    await expect(group.getByRole('button', { name: 'Lia Admin' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(group.getByRole('button', { name: 'Paulo Professor' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await toggleTeacher(page, 'Paulo Professor');
    await page.getByRole('dialog').getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Turma atualizada.')).toBeVisible();
    const call = (await mockCalls(request)).find((c) =>
      c.path.endsWith(`/class-groups/${ID(1103)}`),
    );
    expect(call?.body.teacherMemberIds).toEqual([ID(1052)]);
  });

  test('aula não gerada por conflito do professor tem rótulo próprio', async ({
    page,
    context,
  }) => {
    await page.route('**/class-session-conflicts', (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: ID(1302),
              classGroup: { id: ID(1101), name: 'Futevôlei Iniciante' },
              court: { id: ID(201), name: 'Quadra 1' },
              startsAt: '2026-11-03T22:00:00.000Z',
              endsAt: '2026-11-03T23:00:00.000Z',
              conflictsWith: 'TEACHER',
              createdAt: '2026-10-28T06:15:00.000Z',
            },
          ],
        },
      }),
    );
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/turmas');
    await expect(page.getByTestId('class-conflicts')).toContainText(
      'conflito com uma aula do professor em outro espaço',
    );
  });

  test('editar turma com alunos: capacidade abaixo das matrículas é barrada', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/turmas');
    await openAdvancedEditor(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Nome')).toHaveValue('Futevôlei Avançado');

    await dialog.getByLabel('Capacidade (alunos)').fill('5');
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(dialog.getByText('A turma já tem 8 aluno(s) matriculado(s)')).toBeVisible();
  });

  test('editar turma com alunos: mudar só a capacidade salva (o esporte reenviado é o mesmo)', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/turmas');
    await openAdvancedEditor(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Capacidade (alunos)').fill('10');
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Turma atualizada.')).toBeVisible();

    const call = (await mockCalls(request)).find(
      (c) => c.path.endsWith(`/class-groups/${ID(1102)}`) && c.body.capacity === 10,
    );
    expect(call?.path.startsWith('PATCH ') || call?.path.startsWith('PUT ')).toBe(true);
  });

  test('editar turma com alunos: trocar o esporte de verdade mostra o motivo da API', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/turmas');
    await openAdvancedEditor(page);
    const dialog = page.getByRole('dialog');
    await pick(page, 'cg-sport', 'Beach tênis');
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(
      dialog.getByText('A turma tem 8 aluno(s) matriculado(s): não dá para trocar o esporte.'),
    ).toBeVisible();
  });

  test('desativar turma com matrículas e excluir mostram o motivo da API', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/turmas');
    const advanced = page.getByTestId('class-group-row').filter({ hasText: 'Futevôlei Avançado' });

    await advanced.getByRole('button', { name: 'Desativar Futevôlei Avançado' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Desativar', exact: true }).click();
    await expect(
      dialog.getByText(
        'A turma tem alunos matriculados. Transfira ou desmatricule os alunos antes.',
      ),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Voltar' }).click();

    await advanced.getByRole('button', { name: 'Excluir Futevôlei Avançado' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Excluir', exact: true }).click();
    await expect(dialog.getByText(/A turma tem alunos matriculados/)).toBeVisible();
  });

  test('desativa e reativa uma turma', async ({ page, context, request }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/turmas');
    await page
      .getByTestId('class-group-row')
      .filter({ hasText: 'Futevôlei Iniciante' })
      .getByRole('button', { name: 'Desativar Futevôlei Iniciante' })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Desativar', exact: true }).click();
    await expect(page.getByText('Turma desativada.')).toBeVisible();

    await page
      .getByTestId('class-group-row')
      .filter({ hasText: 'Futevôlei Manhã' })
      .getByRole('button', { name: 'Reativar Futevôlei Manhã' })
      .click();
    await expect(page.getByText('Turma reativada.')).toBeVisible();

    const patches = (await mockCalls(request)).filter(
      (c) => c.path.startsWith('PATCH ') && c.path.includes('/class-groups/'),
    );
    expect(patches.some((c) => c.path.endsWith('000000001101') && c.body.active === false)).toBe(
      true,
    );
    expect(patches.some((c) => c.path.endsWith('000000001103') && c.body.active === true)).toBe(
      true,
    );
  });

  test('professor vê só as próprias turmas e nenhuma ação de gestão', async ({ page, context }) => {
    await loginAs(context, 'teacher');
    await page.goto('/painel/aulas/turmas');
    await expect(page.getByText('Suas turmas fixas')).toBeVisible();
    await expect(page.getByTestId('class-group-row')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Nova turma' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Editar / })).toHaveCount(0);
    await expect(page.getByTestId('class-conflicts')).toHaveCount(0);
  });

  test('professor lê as turmas sem ações de gestão', async ({ page, context }) => {
    await loginAs(context, 'multi');
    await page.goto('/painel');
    await page.getByRole('button', { name: 'Abrir painel' }).nth(1).click();
    await expect(page.getByTestId('space-switcher')).toContainText('Espaço Exemplo B');
    await page.goto('/painel/aulas/turmas');
    await expect(page.getByTestId('class-group-row')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Nova turma' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Excluir / })).toHaveCount(0);
  });

  test('quadra com turmas não pode ser excluída e cita as turmas', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/espaco/quadras');
    await page.getByRole('button', { name: 'Excluir Quadra 1' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Excluir', exact: true }).click();
    await expect(
      dialog.getByText(
        'A quadra tem turmas: Futevôlei Iniciante. Mude ou desative as turmas antes.',
      ),
    ).toBeVisible();
  });
});

test.describe('planos', () => {
  test('lista os planos com valor em reais e vencimento, sem pausa', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/planos');
    await expect(page.getByRole('heading', { name: 'Planos' })).toBeVisible();
    const rows = page.getByTestId('plan-row');
    await expect(rows).toHaveCount(3);

    const twice = rows.filter({ hasText: 'Futevôlei 2x por semana' });
    await expect(twice).toContainText('2x por semana');
    await expect(twice).toContainText('R$ 180,00');
    await expect(twice).toContainText('Todo dia 10');

    const free = rows.filter({ hasText: 'Futevôlei livre' });
    await expect(free).toContainText('Ilimitado');
    await expect(free).toContainText('R$ 250,50');

    await expect(page.getByRole('columnheader', { name: 'Pausa' })).toHaveCount(0);
    await expect(rows.filter({ hasText: '(antigo)' })).toContainText('Inativo');
  });

  test('cria o plano enviando o valor em centavos e o vencimento fixo', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/planos');
    await page.getByRole('button', { name: 'Novo plano' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nome').fill('Plano Criado E2E');
    await pick(page, 'plan-sport', 'Futevôlei');
    await pick(page, 'plan-frequency', 'Ilimitado');
    await dialog.getByLabel('Mensalidade').fill('199,90');
    await dialog.getByLabel('Dia do vencimento').fill('15');
    await expect(dialog.getByText(/pausa/i)).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Plano criado.')).toBeVisible();

    const call = (await mockCalls(request)).find(
      (c) => c.path.endsWith('/plans') && c.body.name === 'Plano Criado E2E',
    );
    expect(call?.path.startsWith('POST ')).toBe(true);
    expect(call?.body).toMatchObject({
      weeklyFrequency: null,
      priceCents: 19990,
      billingDay: 15,
      active: true,
    });
    expect(call?.body).not.toHaveProperty('pauseAllowed');
    expect(call?.body).not.toHaveProperty('maxPauseMonthsPerYear');
  });

  test('vencimento fora de 1 a 28 e valor vazio são barrados', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/planos');
    await page.getByRole('button', { name: 'Novo plano' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nome').fill('Plano inválido');
    await dialog.getByLabel('Dia do vencimento').fill('31');
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(dialog.getByText('O vencimento vai do dia 1 ao 28')).toBeVisible();
    await expect(dialog.getByText('Informe o valor mensal')).toBeVisible();
    await expect(dialog.getByText('Escolha o esporte')).toBeVisible();
  });

  test('salvar o plano com assinaturas sem mudar o esporte funciona', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/planos');
    await page.getByRole('button', { name: 'Editar Futevôlei livre' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Mensalidade')).toHaveValue('250,50');
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Plano atualizado.')).toBeVisible();

    const call = (await mockCalls(request)).find((c) => c.path.endsWith(`/plans/${ID(1202)}`));
    expect(call?.body).toMatchObject({ priceCents: 25050 });
  });

  test('trocar o esporte de plano com assinaturas mostra a contagem', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/planos');
    await page.getByRole('button', { name: 'Editar Futevôlei livre' }).click();
    const dialog = page.getByRole('dialog');
    await pick(page, 'plan-sport', 'Beach tênis');
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(
      dialog.getByText('O plano tem 4 assinatura(s) em andamento: não dá para trocar o esporte.'),
    ).toBeVisible();
  });

  test('professor lê os planos sem ações', async ({ page, context }) => {
    await loginAs(context, 'teacher');
    await page.goto('/painel/aulas/planos');
    await expect(page.getByTestId('plan-row')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Novo plano' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Mensalidade' })).toHaveCount(0);
    await expect(page.getByTestId('plan-row').first()).not.toContainText('R$');
    // O menu também esconde o que o Professor não abre.
    await expect(page.getByRole('link', { name: 'Turmas' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Alunos' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Mensalidades' })).toHaveCount(0);
  });
});

test.describe('professores', () => {
  test('lista os professores com os papéis e as turmas ativas', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/professores');
    await expect(page.getByRole('heading', { name: 'Professores' })).toBeVisible();
    const rows = page.getByTestId('teacher-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'Paulo Professor' })).toContainText('2');
    await expect(rows.filter({ hasText: 'Lia Admin' })).toContainText('Admin');
    await expect(page.getByTestId('teacher-invite-row')).toContainText('novo.prof@exemplo.com');
  });

  test('convida com o papel de Professor', async ({ page, context, request }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/professores');
    await page.getByRole('button', { name: 'Convidar professor' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('E-mail').fill('prof.nova@exemplo.com');
    await dialog.getByRole('button', { name: 'Enviar convite' }).click();
    await expect(page.getByText('Convite enviado por e-mail.')).toBeVisible();
    const call = (await mockCalls(request)).find(
      (c) => c.path.endsWith('/team/invites') && c.body.email === 'prof.nova@exemplo.com',
    );
    expect(call?.body).toEqual({ email: 'prof.nova@exemplo.com', role: 'TEACHER' });
  });

  test('quem só é professor sai da equipe; quem tem outro papel perde só o de professor', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/professores');

    await page.getByRole('button', { name: 'Remover Paulo Professor dos professores' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remover', exact: true }).click();
    await expect(page.getByText('Professor removido.')).toBeVisible();

    await page.getByRole('button', { name: 'Remover Lia Admin dos professores' }).click();
    await expect(page.getByRole('dialog')).toContainText('mantém os outros papéis');
    await page.getByRole('dialog').getByRole('button', { name: 'Remover', exact: true }).click();

    await expect
      .poll(async () => (await mockCalls(request)).map((c) => c.path))
      .toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^DELETE .*\/team\/members\/00000000-0000-4000-8000-000000000051$/),
          expect.stringMatching(/^PUT .*\/team\/members\/00000000-0000-4000-8000-000000000052/),
        ]),
      );
    const replace = (await mockCalls(request)).find(
      (c) => c.path.startsWith('PUT ') && c.path.includes('000000000052'),
    );
    expect(replace?.body).toEqual({ roles: ['ADMIN'] });
  });

  test('professor só lê a lista', async ({ page, context }) => {
    await loginAs(context, 'teacher');
    await page.goto('/painel/aulas/professores');
    await expect(page.getByTestId('teacher-row')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Convidar professor' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /dos professores$/ })).toHaveCount(0);
    await expect(page.getByTestId('teacher-invite-row')).toHaveCount(0);
  });
});

test.describe('configuração das aulas', () => {
  const amount = (page: Page, label: string) => page.getByLabel(`${label}: quantidade`);
  const unit = (page: Page, label: string) => page.getByLabel(`${label}: unidade`);
  const settingsCall = async (request: Parameters<typeof mockCalls>[0]) =>
    (await mockCalls(request)).find((c) => c.path.endsWith('/settings'));

  test('mostra a lista de presença em linguagem natural, sem pausa', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/espaco/configuracoes');

    await expect(page.getByRole('radio', { name: /Automática/ })).toBeChecked();
    await expect(amount(page, 'Abre antes da aula')).toHaveValue('1');
    await expect(unit(page, 'Abre antes da aula')).toContainText('dias');
    await expect(amount(page, 'Fecha antes da aula')).toHaveValue('1');
    await expect(unit(page, 'Fecha antes da aula')).toContainText('horas');
    await expect(page.getByTestId('attendance-summary')).toHaveText(
      'A lista abre 1 dia antes da aula e fecha 1 hora antes. O aluno pode desistir até 2 horas antes da aula.',
    );
    await expect(page.getByText(/pausa/i)).toHaveCount(0);
  });

  test('o tempo se define por atalho ou por número e unidade, e vai em minutos', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/espaco/configuracoes');

    const open = page.getByRole('group', { name: 'Abre antes da aula' });
    await open.getByRole('button', { name: '2 dias' }).click();
    await expect(open.getByRole('button', { name: '2 dias' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(amount(page, 'Abre antes da aula')).toHaveValue('2');
    await expect(page.getByTestId('attendance-summary')).toContainText(
      'A lista abre 2 dias antes da aula e fecha 1 hora antes',
    );

    await amount(page, 'Fecha antes da aula').fill('30');
    await unit(page, 'Fecha antes da aula').click();
    await page.getByRole('option', { name: 'minutos' }).click();
    await expect(page.getByTestId('attendance-summary')).toContainText('fecha 30 minutos antes');

    await page
      .getByRole('group', { name: 'Cancelamento até (antes do horário)' })
      .getByRole('button', { name: '3h' })
      .click();
    await amount(page, 'Antecedência mínima para reservar').fill('2');
    await unit(page, 'Antecedência mínima para reservar').click();
    await page.getByRole('option', { name: 'dias' }).click();

    await page.getByRole('button', { name: 'Salvar configurações' }).click();
    await expect(page.getByText('Configurações salvas.')).toBeVisible();
    expect((await settingsCall(request))?.body).toMatchObject({
      attendanceOpenBeforeMin: 2880,
      attendanceCloseBeforeMin: 30,
      cancellationDeadlineMin: 180,
      bookingMinAdvanceMin: 2880,
    });
  });

  test('modo manual esconde abertura e fechamento e não os envia', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/espaco/configuracoes');
    const modes = page.getByRole('radiogroup', { name: 'Modo da lista de presença' });
    await modes.getByText('Manual', { exact: true }).click();
    await expect(page.getByRole('radio', { name: /Manual/ })).toBeChecked();

    await expect(page.getByTestId('attendance-automatic-fields')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Abre antes da aula' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: /Desistência até/ })).toBeVisible();
    await expect(page.getByTestId('attendance-summary')).toContainText(
      'A lista abre e fecha quando a gestão ou o professor mandar',
    );

    await page.getByLabel('Bloqueia após (dias de atraso)').fill('15');
    await page.getByRole('button', { name: 'Salvar configurações' }).click();
    await expect(page.getByText('Configurações salvas.')).toBeVisible();

    const body = (await settingsCall(request))?.body;
    expect(body).toMatchObject({
      attendanceMode: 'MANUAL',
      attendanceCancelDeadlineMin: 120,
      pastDueBlockEnabled: true,
      pastDueBlockDays: 15,
    });
    expect(body).not.toHaveProperty('attendanceOpenBeforeMin');
    expect(body).not.toHaveProperty('attendanceCloseBeforeMin');
    expect(body).not.toHaveProperty('maxPauseMonthsPerYear');

    // Voltar ao automático devolve os tempos que estavam na tela.
    await modes.getByText('Automática', { exact: true }).click();
    await expect(amount(page, 'Abre antes da aula')).toHaveValue('1');
  });

  test('fechar antes de abrir é barrado em linguagem de gente', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/espaco/configuracoes');
    await page
      .getByRole('group', { name: 'Fecha antes da aula' })
      .getByRole('button', { name: '2 dias' })
      .click();
    await page.getByRole('button', { name: 'Salvar configurações' }).click();
    await expect(page.getByText('A lista precisa abrir antes de fechar')).toBeVisible();
    expect(await settingsCall(request)).toBeUndefined();
  });

  test('desligar o bloqueio por atraso esconde os dias e não os envia', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/espaco/configuracoes');
    await page.getByLabel(/Bloquear a confirmação de presença/).click();
    await expect(page.getByLabel('Bloqueia após (dias de atraso)')).toHaveCount(0);
    await page.getByRole('button', { name: 'Salvar configurações' }).click();
    await expect(page.getByText('Configurações salvas.')).toBeVisible();

    const call = await settingsCall(request);
    expect(call?.body.pastDueBlockEnabled).toBe(false);
    expect(call?.body).not.toHaveProperty('pastDueBlockDays');
  });
});
