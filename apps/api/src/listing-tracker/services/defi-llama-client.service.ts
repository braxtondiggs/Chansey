import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { toErrorInfo } from '../../shared/error.util';

const DEFAULT_BASE_URL = 'https://api.llama.fi';
const FETCH_TIMEOUT_MS = 10_000;

interface DefiLlamaProtocol {
  id: string;
  name: string;
  symbol?: string;
  tvl?: number;
  change_1d?: number;
  change_7d?: number;
  mcap?: number;
  fdv?: number;
  // TVL history is attached via /protocol/:slug endpoint; omitted here for brevity
}

interface CachedProtocolList {
  fetchedAt: number;
  protocols: DefiLlamaProtocol[];
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Lightweight DefiLlama client. Lists protocols and resolves TVL growth for
 * the cross-listing scorer. Results are cached in-memory for an hour to stay
 * within free-tier usage patterns.
 */
@Injectable()
export class DefiLlamaClientService {
  private readonly logger = new Logger(DefiLlamaClientService.name);
  private readonly baseUrl: string;
  private cached: CachedProtocolList | null = null;
  private cachedBySymbol: Map<string, DefiLlamaProtocol> | null = null;

  constructor(configService?: ConfigService) {
    this.baseUrl = configService?.get<string>('DEFILLAMA_BASE_URL') ?? DEFAULT_BASE_URL;
  }

  /**
   * Get TVL growth for a coin by its ticker symbol. Returns percent change
   * over the past 7 days (DefiLlama does not expose a 90d field on the list
   * endpoint; we approximate growth using `change_7d` multiplied to represent
   * longer-term momentum).
   *
   * Returns `null` when the coin has no DefiLlama protocol match.
   */
  async getTvlGrowthPercent(symbol: string): Promise<number | null> {
    await this.listProtocols();
    const match = this.cachedBySymbol?.get(symbol.toLowerCase());
    if (!match) return null;
    // Scale 7d change into a rough 90d proxy (most protocols have volatile 7d
    // signals; this keeps the score value smooth without needing daily history)
    const weekly = match.change_7d ?? 0;
    return weekly * 3;
  }

  async listProtocols(): Promise<DefiLlamaProtocol[]> {
    const now = Date.now();
    if (this.cached && now - this.cached.fetchedAt < CACHE_TTL_MS) {
      return this.cached.protocols;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}/protocols`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`DefiLlama HTTP ${response.status}`);
      }

      const protocols = (await response.json()) as DefiLlamaProtocol[];
      this.cached = { fetchedAt: now, protocols };
      this.cachedBySymbol = this.buildSymbolIndex(protocols);
      return protocols;
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.warn(`DefiLlama fetch failed: ${err.message}`);
      // Return cached data if we have it, even if stale
      if (this.cached) return this.cached.protocols;
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildSymbolIndex(protocols: DefiLlamaProtocol[]): Map<string, DefiLlamaProtocol> {
    const index = new Map<string, DefiLlamaProtocol>();
    for (const protocol of protocols) {
      const key = protocol.symbol?.toLowerCase();
      if (!key) continue;
      if (!index.has(key)) index.set(key, protocol);
    }
    return index;
  }
}
