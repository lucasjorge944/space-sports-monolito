import { type AdEventsInputEventsItem, sendAdEvents } from '@space-sports/api-client';
import type { Ad } from './feed';

/** Limite de eventos por envio em `POST /v1/ads/events`. */
export const AD_EVENTS_MAX_BATCH = 50;
/** Intervalo do envio em lote enquanto o Explorar está aberto. */
export const AD_EVENTS_FLUSH_MS = 10_000;
/** Tempo com a peça ≥ 50% visível para contar a impressão (RF-ADS-08). */
export const AD_IMPRESSION_DELAY_MS = 1_000;

type AdRef = Pick<Ad, 'creativeId' | 'deliveryToken' | 'tokenExpiresAt'>;
type Send = (events: AdEventsInputEventsItem[]) => Promise<unknown>;

function expired(ad: AdRef, now: number): boolean {
  const expiresAt = Date.parse(ad.tokenExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

/**
 * Fila em memória das impressões e cliques (RF-ADS-08). Vai em lote, só com o token assinado de
 * cada entrega: nada de usuário ou aparelho (RN-ADS-03). Falha no envio descarta o lote em silêncio
 * (as métricas não valem uma nova tentativa nem um erro na tela).
 */
export class AdEventQueue {
  private pending: AdEventsInputEventsItem[] = [];
  /** Peças já contadas nesta abertura do Explorar. */
  private impressed = new Set<string>();
  /** Tokens já clicados: a API conta um clique por entrega. */
  private clicked = new Set<string>();
  private sending: Promise<void> | null = null;

  constructor(
    private readonly send: Send,
    private readonly now: () => number = Date.now,
  ) {}

  /** Nova abertura do Explorar: cada peça volta a poder contar uma impressão. */
  startSession(): void {
    this.impressed.clear();
  }

  impression(ad: AdRef): void {
    if (this.impressed.has(ad.creativeId) || expired(ad, this.now())) return;
    this.impressed.add(ad.creativeId);
    this.pending.push({ token: ad.deliveryToken, type: 'IMPRESSION' });
  }

  click(ad: AdRef): void {
    if (this.clicked.has(ad.deliveryToken) || expired(ad, this.now())) return;
    this.clicked.add(ad.deliveryToken);
    this.pending.push({ token: ad.deliveryToken, type: 'CLICK' });
  }

  get size(): number {
    return this.pending.length;
  }

  /** Envia o que está na fila, em lotes de até 50. */
  flush(): Promise<void> {
    if (this.pending.length === 0) return this.sending ?? Promise.resolve();
    const events = this.pending;
    this.pending = [];
    const previous = this.sending ?? Promise.resolve();
    const run = previous.then(async () => {
      for (let i = 0; i < events.length; i += AD_EVENTS_MAX_BATCH) {
        try {
          await this.send(events.slice(i, i + AD_EVENTS_MAX_BATCH));
        } catch {
          // Sem rede, 429 ou token recusado: as métricas desse lote se perdem.
        }
      }
    });
    this.sending = run;
    void run.finally(() => {
      if (this.sending === run) this.sending = null;
    });
    return run;
  }
}

/** Fila do app (uma só, compartilhada pelo carrossel e pela lista). */
export const adEvents = new AdEventQueue((events) => sendAdEvents({ events }));

/**
 * Conta a impressão da peça que fica visível (≥ 50%, decidido por quem chama) por 1 s seguido,
 * só enquanto ativo (Explorar em foco e app em primeiro plano). As fontes (lista e carrossel)
 * informam o que está visível separadamente.
 */
export class ImpressionTracker {
  private sources = new Map<string, Map<string, AdRef>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private active = false;

  constructor(
    private readonly onImpression: (ad: AdRef) => void,
    private readonly delayMs: number = AD_IMPRESSION_DELAY_MS,
  ) {}

  setVisible(source: string, ads: readonly AdRef[]): void {
    this.sources.set(source, new Map(ads.map((ad) => [ad.creativeId, ad])));
    this.sync();
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) this.clearTimers();
    this.sync();
  }

  /** Nova abertura: recomeça o 1 s das peças que estão na tela. */
  restart(): void {
    this.clearTimers();
    this.sync();
  }

  dispose(): void {
    this.active = false;
    this.clearTimers();
    this.sources.clear();
  }

  private visible(): Map<string, AdRef> {
    const all = new Map<string, AdRef>();
    for (const ads of this.sources.values()) for (const [id, ad] of ads) all.set(id, ad);
    return all;
  }

  private clearTimers(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private sync(): void {
    const visible = this.visible();
    for (const [id, timer] of this.timers) {
      if (!visible.has(id)) {
        clearTimeout(timer);
        this.timers.delete(id);
      }
    }
    if (!this.active) return;
    for (const [id, ad] of visible) {
      if (this.timers.has(id)) continue;
      this.timers.set(
        id,
        setTimeout(() => {
          this.timers.delete(id);
          // A peça pode ter recebido um token novo enquanto estava na tela: vale o mais recente.
          this.onImpression(this.visible().get(id) ?? ad);
        }, this.delayMs),
      );
    }
  }
}
