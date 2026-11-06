/** Envio de push a todos os aparelhos de um usuário. */
export interface PushJob {
  /**
   * Chave de idempotência (uuid), gerada ao enfileirar: o mesmo push nunca sai duas vezes, nem
   * se o job rodar de novo. Opcional só para os jobs enfileirados antes dela existir.
   */
  id?: string;
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Tickets `ok` cujos recibos serão consultados mais tarde. */
export interface ReceiptsJob {
  tickets: { id: string; token: string }[];
}

/**
 * Fila de trabalhos das notificações. Classe abstrata para servir de token de injeção: em
 * produção é o BullMQ (retry com backoff, lembretes agendados); em testes e com
 * `JOBS_ENABLED=false`, uma lista em memória.
 */
export abstract class NotificationQueue {
  abstract enqueuePush(job: PushJob): Promise<void>;
  /** Consulta dos recibos do Expo, que ficam prontos alguns minutos depois do envio. */
  abstract enqueueReceipts(job: ReceiptsJob, delayMs: number): Promise<void>;
}

/** Fila em memória: guarda os trabalhos e não executa nada (os testes chamam os serviços). */
export class MemoryNotificationQueue extends NotificationQueue {
  readonly pushes: PushJob[] = [];
  readonly receipts: ReceiptsJob[] = [];

  async enqueuePush(job: PushJob): Promise<void> {
    this.pushes.push(job);
  }

  async enqueueReceipts(job: ReceiptsJob): Promise<void> {
    this.receipts.push(job);
  }
}
