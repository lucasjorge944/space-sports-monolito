import {
  createRequestStateCodec,
  inputRequired,
  inputResponse,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import { type ConfirmationAction, codeHash } from './confirmation.js';
import { done, type ToolContext, type ToolOutcome } from './tool.js';

const KEY = 'confirm';
/** Mesma validade do código de confirmação. */
const STATE_TTL_SECONDS = 600;
const confirmationForm = z.object({
  confirm: z.boolean().describe('Confirmo'),
});

interface Confirmation {
  action: ConfirmationAction;
  /** O código de confirmação desta escrita (a pergunta fica presa a ele). */
  code: string;
  message: string;
}

/**
 * Elicitation antes de gravar (decisão 114): quando o cliente declara suporte, o próprio servidor
 * pede a confirmação ao usuário, sem depender do modelo. Na primeira rodada devolve
 * `input_required` com um `requestState` assinado (`createRequestStateCodec`) e preso à ação, ao
 * usuário e ao hash do código; na nova tentativa, só vale a resposta que volta com esse estado.
 * Resposta sem `requestState` válido (ausente, adulterado, vencido ou de outra escrita) é ignorada
 * e a pergunta é feita de novo. Devolve `null` para seguir com a gravação, ou o resultado a
 * devolver. Sem suporte, segue (o código de confirmação já foi conferido).
 */
export async function confirmWithUser(
  ctx: ToolContext,
  { action, code, message }: Confirmation,
): Promise<ToolOutcome | null> {
  if (!ctx.canElicit) return null;
  const codec = createRequestStateCodec<{ action: ConfirmationAction }>({
    key: ctx.requestStateKey,
    ttlSeconds: STATE_TTL_SECONDS,
    bind: () => ['mcp-confirm', action, ctx.user.sub, codeHash(code)].join('\0'),
  });

  if (await hasValidState(codec, ctx, action)) {
    const answer = inputResponse(ctx.mcp.mcpReq.inputResponses, KEY);
    if (answer.kind !== 'missing') {
      const accepted =
        answer.kind === 'elicit' &&
        answer.action === 'accept' &&
        confirmationForm.safeParse(answer.content).data?.confirm === true;
      if (accepted) return null;
      return done('O usuário não confirmou. Nada foi gravado.', {
        status: 'NOT_CONFIRMED',
        message: 'O usuário recusou ou cancelou a confirmação. Nada foi gravado.',
      });
    }
  }

  return {
    kind: 'input_required',
    result: inputRequired({
      inputRequests: {
        [KEY]: inputRequired.elicit({ message, requestedSchema: confirmationForm }),
      },
      requestState: await codec.mint({ action }, ctx.mcp),
    }),
  };
}

async function hasValidState(
  codec: ReturnType<typeof createRequestStateCodec<{ action: ConfirmationAction }>>,
  ctx: ToolContext,
  action: ConfirmationAction,
): Promise<boolean> {
  // Sem o hook `requestState.verify` no servidor, o SDK entrega o texto cru que o cliente ecoou.
  const raw = ctx.mcp.mcpReq.requestState<unknown>();
  if (typeof raw !== 'string') return false;
  try {
    return (await codec.verify(raw, ctx.mcp)).action === action;
  } catch {
    return false;
  }
}
