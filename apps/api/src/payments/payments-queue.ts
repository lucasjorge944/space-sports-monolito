/** Trabalho da fila de pagamentos (processar webhook, entregar webhook do fake, jobs do fake). */
export interface PaymentJob {
  name: string;
  data: Record<string, unknown>;
  /** Atraso antes de rodar (ex.: aprovação automática do cadastro no fake). */
  delayMs?: number;
  /** Id do job no BullMQ: o mesmo id não entra duas vezes na fila. */
  jobId?: string;
}

export type PaymentJobHandler = (job: PaymentJob) => Promise<unknown>;

/**
 * Fila do pagamento online. Classe abstrata para servir de token de injeção: com `JOBS_ENABLED`,
 * o BullMQ (retry com backoff); sem, uma lista em memória que os testes esvaziam com `drain()`.
 */
export abstract class PaymentsQueue {
  protected handler?: PaymentJobHandler;

  /** Quem executa os trabalhos (o `PaymentJobs`, registrado na subida). */
  setHandler(handler: PaymentJobHandler): void {
    this.handler = handler;
  }

  abstract enqueue(job: PaymentJob): Promise<void>;
}

/** Fila em memória: guarda os trabalhos e só executa no `drain()` (ignorando o atraso). */
export class MemoryPaymentsQueue extends PaymentsQueue {
  readonly jobs: PaymentJob[] = [];

  async enqueue(job: PaymentJob): Promise<void> {
    this.jobs.push(job);
  }

  /**
   * Executa os trabalhos na ordem, inclusive os que eles enfileirarem, até a fila esvaziar.
   * `filter` deixa na fila os que não passarem (ex.: o chargeback atrasado do cartão de teste).
   */
  async drain(filter: (job: PaymentJob) => boolean = () => true): Promise<PaymentJob[]> {
    const done: PaymentJob[] = [];
    const kept: PaymentJob[] = [];
    while (this.jobs.length) {
      const job = this.jobs.shift() as PaymentJob;
      if (!filter(job)) {
        kept.push(job);
        continue;
      }
      if (!this.handler) throw new Error('Fila de pagamentos sem executor.');
      await this.handler(job);
      done.push(job);
    }
    this.jobs.push(...kept);
    return done;
  }

  /** Descarta o que estiver na fila. */
  clear(): void {
    this.jobs.length = 0;
  }
}
