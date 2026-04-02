import * as ccxt from 'ccxt';

import { toErrorInfo } from '../shared/error.util';

export class ExchangeClientPool {
  private readonly clients = new Map<string, ccxt.Exchange>();
  private readonly clientLastUsed = new Map<string, number>();
  private readonly pendingCreations = new Map<string, Promise<ccxt.Exchange>>();
  /** Stale client TTL: 30 minutes */
  private static readonly CLIENT_TTL_MS = 30 * 60 * 1000;
  /** Keys that should never be evicted (long-lived singletons) */
  private static readonly PERMANENT_KEYS = new Set(['default', 'public']);

  get(key: string): ccxt.Exchange | undefined {
    return this.clients.get(key);
  }

  set(key: string, client: ccxt.Exchange): void {
    this.clients.set(key, client);
    this.touch(key);
  }

  has(key: string): boolean {
    return this.clients.has(key);
  }

  touch(key: string): void {
    this.clientLastUsed.set(key, Date.now());
  }

  getPending(key: string): Promise<ccxt.Exchange> | undefined {
    return this.pendingCreations.get(key);
  }

  setPending(key: string, promise: Promise<ccxt.Exchange>): void {
    this.pendingCreations.set(key, promise);
  }

  deletePending(key: string): void {
    this.pendingCreations.delete(key);
  }

  /**
   * Remove and close a single cached client
   */
  async remove(key: string): Promise<void> {
    const client = this.clients.get(key);
    if (client) {
      try {
        await client.close();
      } catch {
        // Swallow - best-effort cleanup
      }
      this.clients.delete(key);
      this.clientLastUsed.delete(key);
    }
  }

  /**
   * Evict user-specific clients that have been idle longer than CLIENT_TTL_MS.
   */
  evictStale(logger?: { debug: (msg: string) => void; warn: (msg: string) => void }, exchangeSlug?: string): void {
    const now = Date.now();
    for (const [key, lastUsed] of this.clientLastUsed) {
      if (ExchangeClientPool.PERMANENT_KEYS.has(key)) continue;
      if (now - lastUsed > ExchangeClientPool.CLIENT_TTL_MS) {
        const client = this.clients.get(key);
        if (client) {
          client.close().catch((error: unknown) => {
            const err = toErrorInfo(error);
            logger?.warn(`Best-effort close failed for stale client '${key}': ${err.message}`);
          });
        }
        this.clients.delete(key);
        this.clientLastUsed.delete(key);
        logger?.debug(`Evicted stale CCXT client '${key}' on ${exchangeSlug}`);
      }
    }
  }

  /**
   * Close all cached clients and clear state
   */
  async closeAll(logger?: { warn: (msg: string) => void }): Promise<void> {
    const closePromises = [...this.clients.entries()].map(async ([key, client]) => {
      try {
        await client.close();
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        logger?.warn(`Failed to close CCXT client '${key}': ${err.message}`);
      }
    });
    await Promise.allSettled(closePromises);
    this.clients.clear();
    this.clientLastUsed.clear();
  }
}
