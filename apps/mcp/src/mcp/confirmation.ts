import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ToolError } from './tool-error.js';

/** Validade do código de confirmação (decisão 114, RN-MCP-02). */
export const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

export type ConfirmationAction = 'create_booking' | 'cancel_booking';

type Scalar = string | number | boolean | null;
export type ConfirmationParams = Record<string, Scalar>;

interface Payload {
  /** Versão do formato. */
  v: 1;
  /** Ação confirmada. */
  a: ConfirmationAction;
  /** Parâmetros canônicos da escrita. */
  p: [string, Scalar][];
  /** Usuário (`sub`). */
  s: string;
  /** Validade (ms desde a época). */
  e: number;
  /** Valores esperados que o servidor confere antes de gravar (ex.: o preço mostrado no resumo). */
  x?: Record<string, Scalar>;
}

export interface IssuedCode {
  code: string;
  expiresAt: Date;
}

/** Ordem fixa das chaves e ausente = nulo: o mesmo pedido gera sempre o mesmo texto. */
function canonical(params: ConfirmationParams): [string, Scalar][] {
  return Object.keys(params)
    .sort()
    .map((key) => [key, params[key] ?? null]);
}

const b64 = (value: Buffer | string) => Buffer.from(value).toString('base64url');

/**
 * Código de confirmação das escritas em duas etapas: `v1.<payload>.<HMAC-SHA256>`, com os
 * parâmetros canônicos, o usuário e a validade. Assinado com `MCP_CONFIRMATION_SECRET`; o
 * servidor não guarda nada (sem estado). Conferido em tempo constante.
 */
export class ConfirmationCodes {
  constructor(
    private readonly secret: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  issue(
    action: ConfirmationAction,
    sub: string,
    params: ConfirmationParams,
    expected?: Record<string, Scalar>,
  ): IssuedCode {
    const expiresAt = new Date(this.now().getTime() + CONFIRMATION_TTL_MS);
    const payload: Payload = {
      v: 1,
      a: action,
      p: canonical(params),
      s: sub,
      e: expiresAt.getTime(),
      ...(expected ? { x: expected } : {}),
    };
    const body = `v1.${b64(JSON.stringify(payload))}`;
    return { code: `${body}.${this.sign(body)}`, expiresAt };
  }

  /**
   * Confere o código para a ação, o usuário e os parâmetros informados. Recusa (sem chamar a API)
   * código ausente, malformado, adulterado, vencido, de outro usuário, de outra ação ou com outro
   * parâmetro. Devolve os valores esperados gravados no código.
   */
  verify(
    code: string | undefined,
    action: ConfirmationAction,
    sub: string,
    params: ConfirmationParams,
  ): Record<string, Scalar> {
    if (!code) throw invalid('CONFIRMATION_REQUIRED', 'Falta o código de confirmação.');
    const parts = code.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') throw invalid('CONFIRMATION_INVALID');
    const body = `${parts[0]}.${parts[1]}`;
    // Compara o texto canônico da assinatura (não o decodificado): o decodificador base64url
    // ignora `=`, `~`, `!` e afins, e cada variante aceita viraria outra Idempotency-Key.
    const given = Buffer.from(parts[2] ?? '');
    const expectedSig = Buffer.from(this.sign(body));
    if (given.length !== expectedSig.length || !timingSafeEqual(given, expectedSig)) {
      throw invalid('CONFIRMATION_INVALID');
    }
    let payload: Payload;
    try {
      payload = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')) as Payload;
    } catch {
      throw invalid('CONFIRMATION_INVALID');
    }
    if (payload.v !== 1 || payload.a !== action) throw invalid('CONFIRMATION_INVALID');
    if (payload.s !== sub) throw invalid('CONFIRMATION_INVALID');
    if (!(payload.e > this.now().getTime())) {
      throw invalid('CONFIRMATION_EXPIRED', 'O código de confirmação venceu (vale 10 minutos).');
    }
    if (JSON.stringify(payload.p) !== JSON.stringify(canonical(params))) {
      throw invalid(
        'CONFIRMATION_MISMATCH',
        'Os parâmetros não são os mesmos do resumo confirmado.',
      );
    }
    return payload.x ?? {};
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }
}

function invalid(code: string, reason = 'O código de confirmação é inválido.'): ToolError {
  const next = code.startsWith('CONFIRMATION')
    ? ' Nada foi gravado. Chame a tool prepare_* de novo, mostre o novo resumo ao usuário e peça a confirmação.'
    : '';
  return new ToolError(code, `${reason}${next}`);
}

/**
 * `Idempotency-Key` da criação, derivada só do corpo assinado do código (`v1.<payload>`): repetir a
 * chamada devolve a mesma reserva, e nenhuma variação no texto da assinatura gera outra chave.
 */
export function idempotencyKeyFor(code: string): string {
  const body = code.split('.').slice(0, 2).join('.');
  return `mcp-${createHash('sha256').update(body).digest('hex')}`;
}

/** Hash do código, para prender a confirmação por elicitation a ele sem expor o código. */
export function codeHash(code: string): string {
  return createHash('sha256').update(code).digest('base64url');
}
