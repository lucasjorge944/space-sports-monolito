import { PERIOD_MAX_DATE, PERIOD_MIN_DATE } from '@space-sports/shared';
import { z } from 'zod';
import { dateBetween } from '../../shared/time.js';
import { defineTool, done } from '../tool.js';
import { classSessionView } from '../views.js';

/** Período das aulas: a faixa que a API aceita (`periodDateSchema`). */
const CLASS_DATE_RANGE = `de ${PERIOD_MIN_DATE} a ${PERIOD_MAX_DATE}`;
const classDateSchema = dateBetween(PERIOD_MIN_DATE, PERIOD_MAX_DATE);

const sessionIdSchema = z.uuid('Use o id da aula (uuid) de list_my_classes.');

const listMyClasses = defineTool({
  name: 'list_my_classes',
  title: 'Minhas aulas',
  scopes: ['classes:read'],
  description: [
    'Lista as aulas das turmas em que o usuário está matriculado, num período (padrão: os próximos dias, como no app).',
    'Devolve id, turma, esporte, nível, espaço, quadra, data e horário (America/Sao_Paulo), status da aula e da lista de presença, a presença do usuário (confirmada, lista de espera e posição), se dá para confirmar ou desmarcar agora (e o motivo quando não dá) e o prazo para desmarcar.',
    'Use os ids com confirm_class_attendance e cancel_class_attendance.',
  ].join(' '),
  inputSchema: z.object({
    from: classDateSchema.optional().describe(`Data inicial (YYYY-MM-DD, ${CLASS_DATE_RANGE}).`),
    to: classDateSchema.optional().describe(`Data final (YYYY-MM-DD, ${CLASS_DATE_RANGE}).`),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(input, { api }) {
    const result = await api.listClassSessions({
      ...(input.from ? { from: input.from } : {}),
      ...(input.to ? { to: input.to } : {}),
    });
    const classes = result.items.map(classSessionView);
    return done(
      classes.length
        ? `${classes.length} aula(s) entre ${result.from} e ${result.to}.`
        : `O usuário não tem aulas entre ${result.from} e ${result.to}.`,
      { from: result.from, to: result.to, classes },
    );
  },
});

const confirmAttendance = defineTool({
  name: 'confirm_class_attendance',
  title: 'Confirmar presença na aula',
  scopes: ['classes:write'],
  description: [
    'Confirma a presença do usuário numa aula da turma dele (ou entra na lista de espera, se a aula estiver cheia). Reversível com cancel_class_attendance e sem cobrança.',
    'Confirme com o usuário qual aula antes de chamar. Devolve a aula com a presença atualizada (confirmada ou posição na lista de espera).',
  ].join(' '),
  inputSchema: z.object({ sessionId: sessionIdSchema }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async run(input, { api }) {
    const session = classSessionView(await api.confirmAttendance(input.sessionId));
    return done(
      `${session.myAttendance?.statusLabel ?? 'Presença registrada'}: ${session.className}, ${session.date} às ${session.startTime}.`,
      { class: session },
    );
  },
});

const cancelAttendance = defineTool({
  name: 'cancel_class_attendance',
  title: 'Desmarcar presença na aula',
  scopes: ['classes:write'],
  description: [
    'Desmarca a presença do usuário numa aula (ou o tira da lista de espera), dentro do prazo do espaço. A vaga pode ir para outra pessoa da lista de espera.',
    'Confirme com o usuário qual aula antes de chamar. Devolve a aula atualizada.',
  ].join(' '),
  inputSchema: z.object({ sessionId: sessionIdSchema }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  async run(input, { api }) {
    const session = classSessionView(await api.withdrawAttendance(input.sessionId));
    return done(
      `Presença desmarcada: ${session.className}, ${session.date} às ${session.startTime}.`,
      {
        class: session,
      },
    );
  },
});

export const classTools = [listMyClasses, confirmAttendance, cancelAttendance];
