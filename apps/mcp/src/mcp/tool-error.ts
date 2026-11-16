/** Falha de uma tool com código estável e mensagem em português para o assistente. */
export class ToolError extends Error {
  override readonly name = 'ToolError';
  constructor(
    readonly code: string,
    message: string,
    /** Dados para o assistente agir (ex.: opções de um nome ambíguo). Sem dados pessoais. */
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
  }
}
