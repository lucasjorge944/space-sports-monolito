import { Injectable } from '@nestjs/common';

/** Tempo da consulta das campanhas no ar em memória (RF-ADS-07). */
export const AD_CANDIDATES_TTL_MS = 60_000;

/**
 * Cache curto, em memória e por instância, das peças no ar de cada vaga (a consulta pesada da
 * entrega). As escritas do Super nesta instância limpam o cache na hora; as outras instâncias
 * enxergam a mudança em até 1 minuto, como a saída de um espaço da vitrine.
 */
@Injectable()
export class AdCandidatesCache {
  private readonly entries = new Map<string, { at: number; value: Promise<unknown> }>();
  /** Os testes de integração zeram para enxergar as mudanças feitas direto no banco. */
  ttlMs = AD_CANDIDATES_TTL_MS;

  /** Valor da chave, carregado de novo depois do TTL (pedidos simultâneos dividem a carga). */
  get<T>(key: string, load: () => Promise<T>, now: number = Date.now()): Promise<T> {
    const entry = this.entries.get(key);
    if (entry && now - entry.at < this.ttlMs) return entry.value as Promise<T>;
    const value = load();
    this.entries.set(key, { at: now, value });
    // Falha não fica no cache: o próximo pedido tenta de novo.
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}
