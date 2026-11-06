import { expect, type Page, test } from '@playwright/test';
import { loginAs, MOCK_API } from './helpers';

// RF-CLASS-07..10, RN-CLASS-03..05 e decisão 32 contra a API simulada (e2e/mock-classes.mjs). Cada
// teste usa a sua sessão de aula, porque os testes rodam em paralelo e a API simulada guarda estado.
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const session = (n: number) => `/painel/aulas/sessoes/${ID(7000 + n)}`;
const DAY = '2026-11-04';

/** Fixa o relógio do navegador (07:00 locais por padrão, antes de todas as aulas do dia). */
async function setClock(page: Page, iso = '2026-11-04T10:00:00Z') {
  await page
    .context()
    .addCookies([{ name: 'e2e-classes', value: '1', url: 'http://localhost:3100' }]);
  await page.clock.install({ time: new Date(iso) });
}

async function sessionCalls(request: import('@playwright/test').APIRequestContext, n: number) {
  const response = await request.get(`${MOCK_API}/__classes-calls`);
  const calls = (await response.json()) as {
    method: string;
    path: string;
    body: Record<string, unknown>;
  }[];
  return calls.filter((c) => c.path.includes(ID(7000 + n)));
}

test.describe('calendário de sessões', () => {
  test('lista o dia com status, professor, quadra, ocupação e espera', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await setClock(page);
    await page.goto(`/painel/aulas/sessoes?data=${DAY}&visao=dia`);
    await expect(page.getByRole('heading', { name: 'Sessões' })).toBeVisible();
    await expect(page.getByTestId('session-card')).toHaveCount(12);

    const card = page.getByTestId('session-card').filter({ hasText: '09:00–10:00' });
    await expect(card).toContainText('Futevôlei iniciante');
    await expect(card).toContainText('Lista aberta');
    await expect(card).toContainText('Professor Rafa');
    await expect(card).toContainText('Quadra 1');
    await expect(card).toContainText('2/2 vagas');
    await expect(card).toContainText('2 na espera');
    await expect(
      page.getByTestId('session-card').filter({ hasText: 'Agendada' }).first(),
    ).toBeVisible();
    await expect(page.getByTestId('session-card').filter({ hasText: 'Cancelada' })).toHaveCount(1);
    await expect(page.getByTestId('session-card').filter({ hasText: 'Realizada' })).toHaveCount(1);
  });

  test('semana mostra os sete dias e o filtro de situação refaz a consulta', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await setClock(page);
    await page.goto(`/painel/aulas/sessoes?data=${DAY}&visao=semana`);
    await expect(page.getByTestId('sessions-day')).toHaveCount(7);
    await expect(page.getByTestId('sessions-day').filter({ hasText: 'Sem aulas' })).toHaveCount(6);

    await page.getByRole('combobox', { name: 'Filtrar por situação' }).click();
    await page.getByRole('option', { name: 'Cancelada' }).click();
    await expect(page).toHaveURL(/situacao=CANCELLED/);
    await expect(page.getByTestId('session-card')).toHaveCount(1);
  });

  test('Professor só vê as próprias aulas e não tem filtro de professor', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'teacher');
    await setClock(page);
    await page.goto(`/painel/aulas/sessoes?data=${DAY}&visao=dia`);
    await expect(page.getByTestId('session-card')).toHaveCount(11);
    await expect(page.getByText('Professora Lia')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Filtrar por professor' })).toHaveCount(0);
  });

  test('dia sem aulas mostra o estado vazio', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/sessoes?data=2026-11-10&visao=dia');
    await expect(page.getByText('Nenhuma aula neste período')).toBeVisible();
  });

  test('falha da API mostra o erro com nova tentativa', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.route('**/v1/manage/spaces/*/class-sessions?*', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'FORBIDDEN', message: 'x' }, requestId: 'r' }),
      }),
    );
    await page.goto(`/painel/aulas/sessoes?data=${DAY}&visao=dia`);
    // 4xx não é repetido pelo React Query (5xx faz novas tentativas antes de mostrar o erro).
    await expect(page.getByText('Não foi possível carregar as sessões')).toBeVisible();
    await expect(page.getByText('Você não tem permissão para esta ação.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
  });
});

test.describe('detalhe da sessão', () => {
  test('mostra a ocupação, os confirmados e a espera com posição', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await setClock(page);
    await page.goto(session(2));
    await expect(page.getByRole('heading', { name: 'Futevôlei iniciante' })).toBeVisible();
    await expect(page.getByTestId('session-occupancy')).toHaveText('2/2 · lotada');
    await expect(page.getByTestId('attendee-row')).toHaveCount(2);
    const waiting = page.getByTestId('waitlist-row');
    await expect(waiting).toHaveCount(2);
    await expect(waiting.nth(0)).toContainText('1º');
    await expect(waiting.nth(0)).toContainText('Caio Mendes');
    await expect(waiting.nth(1)).toContainText('2º');
    await expect(waiting.nth(1)).toContainText('adicionado pela equipe');
    // Antes do início da aula não há como marcar presença.
    await expect(page.getByRole('button', { name: /como presente/ })).toHaveCount(0);
  });

  test('abre, fecha e reabre a lista manualmente', async ({ page, context, request }) => {
    await loginAs(context, 'manager');
    await setClock(page);
    await page.goto(session(1));
    await expect(page.getByTestId('session-summary')).toContainText('Agendada');

    await page.getByRole('button', { name: 'Abrir lista' }).click();
    await expect(page.getByText('Lista aberta.')).toBeVisible();
    await expect(page.getByTestId('session-summary')).toContainText('Lista aberta');

    await page.getByRole('button', { name: 'Fechar lista' }).click();
    await expect(page.getByText('Lista fechada.')).toBeVisible();
    await expect(page.getByTestId('session-summary')).toContainText('Lista fechada');

    await page.getByRole('button', { name: 'Reabrir lista' }).click();
    await expect(page.getByText('Lista reaberta.')).toBeVisible();

    const calls = await sessionCalls(request, 1);
    expect(calls.map((c) => c.path.split('/').pop())).toEqual(['open', 'close', 'open']);
  });

  test('remove aluno confirmado e a espera é promovida', async ({ page, context, request }) => {
    await loginAs(context, 'manager');
    await setClock(page);
    await page.goto(session(3));
    await expect(page.getByTestId('session-occupancy')).toHaveText('1/1 · lotada');
    await page.getByRole('button', { name: 'Remover Ana Souza da aula' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remover da aula' }).click();
    await expect(page.getByText('Ana Souza removido da aula.')).toBeVisible();
    await expect(page.getByTestId('attendee-row')).toHaveCount(1);
    await expect(page.getByTestId('attendee-row')).toContainText('Caio Mendes');
    await expect(page.getByTestId('waitlist-row')).toHaveCount(0);
    expect((await sessionCalls(request, 3)).some((c) => c.method === 'DELETE')).toBe(true);
  });

  test('409 PRESENCE_ALREADY_MARKED: explica, recarrega e tira o botão de remover', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await setClock(page);
    await page.goto(session(4));
    // Quem já está presente não tem botão de remover; o Edu ainda aparece como confirmado.
    await expect(page.getByRole('button', { name: 'Remover Ana Souza da aula' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Remover Edu Prado da aula' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Remover da aula' }).click();
    await expect(dialog.getByRole('alert')).toContainText('já tem presença marcada');
    await expect(dialog.getByRole('button', { name: 'Remover da aula' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByTestId('attendee-row').filter({ hasText: 'Edu Prado' })).toContainText(
      'Presente',
    );
    await expect(page.getByRole('button', { name: 'Remover Edu Prado da aula' })).toHaveCount(0);
  });

  test('marca presente e faltou depois do início da aula, inclusive matriculado fora da lista', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    // 14:30 locais: a aula das 14:00 está em andamento.
    await setClock(page, '2026-11-04T17:30:00Z');
    await page.goto(session(5));
    await page.getByRole('button', { name: 'Marcar Fábio Alves como presente' }).click();
    await expect(
      page.getByRole('button', { name: 'Marcar Fábio Alves como presente' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Marcar Gabi Nunes como faltou' }).click();
    await expect(
      page.getByRole('button', { name: 'Marcar Gabi Nunes como faltou' }),
    ).toHaveAttribute('aria-pressed', 'true');
    // Hugo é matriculado, mas não confirmou: marcar a presença o inclui na aula.
    await page.getByRole('button', { name: 'Marcar Hugo Dias como presente' }).click();
    await expect(page.getByTestId('attendee-row').filter({ hasText: 'Hugo Dias' })).toContainText(
      'Presente',
    );
    // Presentes e faltosos ocupam vaga: 3 de 5.
    await expect(page.getByTestId('session-occupancy')).toHaveText('3/5');

    const bodies = (await sessionCalls(request, 5)).map((c) => c.body.items);
    expect(bodies).toContainEqual([{ userId: ID(1006), status: 'PRESENT' }]);
    expect(bodies).toContainEqual([{ userId: ID(1007), status: 'ABSENT' }]);
  });

  test('a presença aparece sozinha quando a aula começa com a tela aberta', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    // 19:59 locais: a aula das 20:00 ainda não começou.
    await setClock(page, '2026-11-04T22:59:00Z');
    await page.goto(session(12));
    await expect(page.getByTestId('attendee-row')).toContainText('Fábio Alves');
    await expect(page.getByText('pode ser marcada a partir do início da aula')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Marcar Fábio Alves como presente' }),
    ).toHaveCount(0);
    await page.clock.runFor(2 * 60_000);
    await expect(
      page.getByRole('button', { name: 'Marcar Fábio Alves como presente' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Marcar Fábio Alves como faltou' }),
    ).toBeVisible();
  });

  test('adiciona aluno pela busca, sem diferenciar acentos, e inclui outros alunos do espaço', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await setClock(page);
    await page.goto(session(8));
    await page.getByRole('button', { name: 'Adicionar aluno' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Buscar aluno pelo nome').fill('jor');
    await expect(dialog.getByTestId('add-candidate')).toHaveCount(1);
    await expect(dialog.getByTestId('add-candidate')).toContainText('Jorge Teles');
    await expect(dialog.getByTestId('add-candidate')).toContainText('Outro aluno do espaço');

    await dialog.getByLabel('Buscar aluno pelo nome').fill('iris');
    await dialog.getByRole('button', { name: 'Adicionar Íris Costa' }).click();
    await expect(page.getByText('Íris Costa adicionado à aula.')).toBeVisible();
    await expect(page.getByTestId('attendee-row').filter({ hasText: 'Íris Costa' })).toContainText(
      'adicionado pela equipe',
    );
    const calls = await sessionCalls(request, 8);
    // Outro teste tenta adicionar o Jorge nesta mesma sessão: conta só a chamada da Íris.
    expect(
      calls.find((c) => c.path.endsWith('/attendances') && c.body.userId === ID(1009))?.body,
    ).toEqual({ userId: ID(1009) });
  });

  test('aluno que já está em outra aula no mesmo horário não entra e mostra qual é', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await setClock(page);
    await page.goto(session(8));
    await page.getByRole('button', { name: 'Adicionar aluno' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Buscar aluno pelo nome').fill('jor');
    await dialog.getByRole('button', { name: 'Adicionar Jorge Teles' }).click();
    const alert = dialog.getByRole('alert');
    await expect(alert).toContainText(
      'O aluno já está na lista da aula Vôlei Misto (Arena Beira-Mar)',
    );
    // Só nome, espaço e horário: a situação do aluno na outra aula não é exposta.
    await expect(alert).not.toContainText(/confirmad/i);
    await expect(page.getByText('Jorge Teles adicionado à aula.')).toHaveCount(0);
  });

  test('cancelar exige motivo e avisa que os alunos serão notificados', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await setClock(page);
    await page.goto(session(6));
    await page.getByRole('button', { name: 'Cancelar aula' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('serão avisados');
    const confirm = dialog.getByRole('button', { name: 'Cancelar aula' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Motivo do cancelamento').fill('Feriado municipal');
    await confirm.click();
    await expect(page.getByText('Aula cancelada. Os alunos serão avisados.')).toBeVisible();
    await expect(page.getByTestId('session-summary')).toContainText('Cancelada');
    await expect(page.getByText('Motivo: Feriado municipal')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abrir lista' })).toHaveCount(0);
    const calls = await sessionCalls(request, 6);
    expect(calls.find((c) => c.path.endsWith('/cancel'))?.body).toEqual({
      reason: 'Feriado municipal',
    });
  });

  test('Professores desta aula: soma um professor só nesta sessão', async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, 'manager');
    await setClock(page);
    await page.goto(session(7));
    await page.getByRole('button', { name: 'Professores desta aula' }).click();
    const dialog = page.getByRole('dialog', { name: 'Professores desta aula' });
    await expect(dialog.getByRole('button', { name: 'Salvar professores' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Professora Lia' }).click();
    await dialog.getByRole('button', { name: 'Salvar professores' }).click();
    await expect(page.getByText('Professores da aula atualizados.')).toBeVisible();
    const summary = page.getByTestId('session-summary');
    await expect(summary).toContainText('Professores');
    await expect(summary).toContainText('Professor Rafa, Professora Lia');
    const calls = await sessionCalls(request, 7);
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      teacherMemberIds: [ID(80), ID(81)],
    });
  });

  test('a aula precisa de ao menos um professor', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await setClock(page);
    await page.goto(session(8));
    await page.getByRole('button', { name: 'Professores desta aula' }).click();
    const dialog = page.getByRole('dialog', { name: 'Professores desta aula' });
    await dialog.getByRole('button', { name: 'Professor Rafa' }).click();
    await expect(dialog.getByText('Escolha ao menos um professor')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Salvar professores' })).toBeDisabled();
  });

  test('conflito de professor na aula explica o horário', async ({ page, context }) => {
    await page.route('**/class-sessions/*', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 409,
            json: {
              error: {
                code: 'TEACHER_SCHEDULE_CONFLICT',
                message: 'Conflito.',
                details: {
                  teacher: { memberId: ID(81), name: 'Professora Lia' },
                  startsAt: '2026-11-04T22:00:00.000Z',
                  endsAt: '2026-11-04T23:00:00.000Z',
                  timeZone: 'America/Sao_Paulo',
                },
              },
            },
          })
        : route.fallback(),
    );
    await loginAs(context, 'manager');
    await setClock(page);
    await page.goto(session(8));
    await page.getByRole('button', { name: 'Professores desta aula' }).click();
    const dialog = page.getByRole('dialog', { name: 'Professores desta aula' });
    await dialog.getByRole('button', { name: 'Professora Lia' }).click();
    await dialog.getByRole('button', { name: 'Salvar professores' }).click();
    await expect(dialog.getByRole('alert')).toContainText(
      'Professora Lia já tem aula em outro espaço em 04/11/2026, 19:00 às 20:00',
    );
  });

  test('aula cancelada mostra o motivo e nenhuma ação', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await setClock(page);
    await page.goto(session(9));
    await expect(page.getByText('Motivo: Chuva forte')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abrir lista' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancelar aula' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Adicionar aluno' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /como presente/ })).toHaveCount(0);
  });

  test('aula inexistente mostra o estado de não encontrada', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto(session(99));
    await expect(page.getByText('Aula não encontrada')).toBeVisible();
  });
});

test.describe('permissões', () => {
  test('Professor abre e fecha a própria aula, mas não cancela nem troca o professor', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'teacher');
    await setClock(page);
    await page.goto(session(8));
    await expect(page.getByRole('button', { name: 'Fechar lista' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adicionar aluno' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancelar aula' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Professores desta aula' })).toHaveCount(0);
  });

  test('Professor não acessa a aula de outro professor', async ({ page, context }) => {
    await loginAs(context, 'teacher');
    await page.goto(session(10));
    await expect(page.getByText('Aula não encontrada')).toBeVisible();
  });
});

test.describe('presença e frequência', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: 'e2e-classes', value: '1', url: 'http://localhost:3100' }]);
  });

  test('frequência da turma leva ao histórico do aluno', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.goto(
      `/painel/aulas/sessoes/presencas?turma=${ID(701)}&de=2026-10-06&ate=2026-11-04`,
    );
    const frequency = page.getByTestId('frequency');
    await expect(frequency).toContainText('Aulas dadas');
    await expect(frequency).toContainText('70%');
    await expect(page.getByTestId('frequency-row')).toHaveCount(2);
    await expect(page.getByTestId('frequency-row').filter({ hasText: 'Bruno Lima' })).toContainText(
      '60%',
    );

    await page.getByRole('button', { name: 'Ver histórico de Ana Souza' }).click();
    await expect(page).toHaveURL(/aba=aluno/);
    await expect(page.getByTestId('history')).toContainText('Histórico de Ana Souza');
    await expect(page.getByTestId('history-row').first()).toBeVisible();
    await expect(page.getByTestId('history')).toContainText('Presente');
  });

  test('sem turma nem aluno pede a escolha; período inválido é recusado', async ({
    page,
    context,
  }) => {
    await loginAs(context, 'manager');
    await page.goto('/painel/aulas/sessoes/presencas?aba=aluno');
    await expect(page.getByText('Escolha uma turma ou um aluno')).toBeVisible();
    await page.goto('/painel/aulas/sessoes/presencas?de=2026-11-04&ate=2026-10-01');
    await expect(page.getByText('A data inicial não pode ser depois da final.')).toBeVisible();
  });
});
