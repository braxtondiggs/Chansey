import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Not, Repository } from 'typeorm';

import { Coin } from '../../coin/coin.entity';
import {
  CachedTicker,
  ExchangeTickerFetcherService
} from '../../coin/ticker-pairs/services/exchange-ticker-fetcher.service';
import { TickerPairStatus, TickerPairs } from '../../coin/ticker-pairs/ticker-pairs.entity';
import { Exchange } from '../../exchange/exchange.entity';
import { toErrorInfo } from '../../shared/error.util';

interface TargetExchangeMeta {
  slug: string;
  name: string;
  /** CoinGecko identifier(s) to pass to `ExchangeTickerFetcherService`, tried in order */
  geckoIdentifiers: readonly string[];
}

/**
 * CoinGecko exchange identifiers for the **seed** target set — a deliberate
 * subset of `CrossListingScorerService.TARGET_EXCHANGES` (`kucoin`, `gate`,
 * `gateio`, `okx`, `kraken`). The two lists intentionally differ:
 *
 * - `kraken` is omitted because `ticker_pairs` for kraken is already populated
 *   by the existing kraken ticker-pairs sync (`TickerPairSyncTask`).
 * - `gateio` is omitted because it shares CoinGecko's `gate` cache — a
 *   separate entry would be a redundant duplicate fetch.
 *
 * The slug list below is derived from this metadata so the two can't drift.
 */
const TARGET_EXCHANGE_METADATA: readonly TargetExchangeMeta[] = [
  { slug: 'kucoin', name: 'KuCoin', geckoIdentifiers: ['kucoin'] },
  { slug: 'gate', name: 'Gate.io', geckoIdentifiers: ['gate'] },
  { slug: 'okx', name: 'OKX', geckoIdentifiers: ['okx'] }
];

const TARGET_EXCHANGE_SLUGS: readonly string[] = TARGET_EXCHANGE_METADATA.map((m) => m.slug);

export interface SeedResult {
  coinsConsidered: number;
  pairsInserted: number;
  pairsUpdated: number;
  pairsSkipped: number;
  exchangeUpserted: string[];
  tickersByExchange: Record<string, number>;
  errors: string[];
}

/**
 * Seeds `ticker_pairs` rows for cross-listing target exchanges (kucoin/gate/okx)
 * by reading the 8-day Redis-cached output of CoinGecko's `/exchanges/{id}/tickers`
 * endpoint via `ExchangeTickerFetcherService`.
 *
 * Runs weekly. The cache is shared with `TickerPairSyncTask`, so steady-state
 * CoinGecko weight is 0-3 calls/week (0 when `TickerPairSyncTask` warmed the
 * cache within the last 8 days).
 *
 * The scorer (`CrossListingScorerService`) reads from `ticker_pairs` to count
 * cross-listings on target exchanges. Without this seeding, no coin can clear
 * the `minTargetExchanges` gate.
 */
@Injectable()
export class CrossListingTickerSeedService {
  private readonly logger = new Logger(CrossListingTickerSeedService.name);

  constructor(
    @InjectRepository(Coin) private readonly coinRepo: Repository<Coin>,
    @InjectRepository(TickerPairs) private readonly tickerRepo: Repository<TickerPairs>,
    @InjectRepository(Exchange) private readonly exchangeRepo: Repository<Exchange>,
    private readonly tickerFetcher: ExchangeTickerFetcherService
  ) {}

  async seedFromCachedExchangeTickers(): Promise<SeedResult> {
    const result: SeedResult = {
      coinsConsidered: 0,
      pairsInserted: 0,
      pairsUpdated: 0,
      pairsSkipped: 0,
      exchangeUpserted: [],
      tickersByExchange: {},
      errors: []
    };

    const exchanges = await this.ensureTargetExchanges();
    result.exchangeUpserted = exchanges.map((e) => e.slug);

    const coins = await this.coinRepo.find({
      where: { marketRank: Not(IsNull()), delistedAt: IsNull() }
    });
    result.coinsConsidered = coins.length;

    const coinBySlug = new Map<string, Coin>(coins.map((coin) => [coin.slug.toLowerCase(), coin]));

    this.logger.log(
      `Seeding cross-listing tickers from per-exchange cache — ${coins.length} coins indexed, ${exchanges.length} target exchanges`
    );

    for (const exchange of exchanges) {
      const meta = TARGET_EXCHANGE_METADATA.find((m) => m.slug === exchange.slug);
      if (!meta) continue;

      try {
        const tickers = await this.fetchExchangeTickers(meta.geckoIdentifiers);
        result.tickersByExchange[exchange.slug] = tickers.length;

        if (tickers.length === 0) {
          this.logger.warn(`No tickers returned for ${exchange.slug}, skipping`);
          continue;
        }

        const bestByCoin = this.selectHighestVolumePerCoin(tickers, coinBySlug);
        if (bestByCoin.size === 0) continue;

        const existingTickers = await this.tickerRepo.find({
          where: { exchange: { id: exchange.id } },
          select: { id: true, symbol: true, volume: true, tradeUrl: true, spreadPercentage: true }
        });
        const existingBySymbol = new Map(existingTickers.map((t) => [t.symbol, t]));

        const toSave: TickerPairs[] = [];
        const entityMeta = new Map<TickerPairs, { action: 'insert' | 'update'; coinSlug: string }>();

        for (const { coin, ticker } of bestByCoin.values()) {
          const built = this.buildUpsertEntity(coin, ticker, exchange, existingBySymbol);
          if (built.action === 'skip' || !built.entity) {
            result.pairsSkipped += 1;
            continue;
          }
          toSave.push(built.entity);
          entityMeta.set(built.entity, { action: built.action, coinSlug: coin.slug });
        }

        if (toSave.length === 0) continue;

        try {
          await this.tickerRepo.save(toSave, { chunk: 200 });
          for (const meta of entityMeta.values()) {
            if (meta.action === 'insert') result.pairsInserted += 1;
            else result.pairsUpdated += 1;
          }
        } catch (bulkError) {
          const bulkErr = toErrorInfo(bulkError);
          this.logger.warn(
            `Bulk save failed for ${exchange.slug} (${toSave.length} rows): ${bulkErr.message} — falling back to per-row saves`
          );
          for (const entity of toSave) {
            const meta = entityMeta.get(entity);
            if (!meta) continue;
            try {
              await this.tickerRepo.save(entity);
              if (meta.action === 'insert') result.pairsInserted += 1;
              else result.pairsUpdated += 1;
            } catch (error) {
              const err = toErrorInfo(error);
              const msg = `${exchange.slug}:${meta.coinSlug}: ${err.message}`;
              result.errors.push(msg);
              this.logger.warn(`Upsert failure for ${msg}`);
            }
          }
        }
      } catch (error) {
        const err = toErrorInfo(error);
        const msg = `${exchange.slug}: ${err.message}`;
        result.errors.push(msg);
        this.logger.warn(`Seed failure for ${msg}`);
      }
    }

    this.logger.log(
      `Cross-listing seed complete: considered=${result.coinsConsidered}, inserted=${result.pairsInserted}, updated=${result.pairsUpdated}, skipped=${result.pairsSkipped}, errors=${result.errors.length}`
    );
    return result;
  }

  /**
   * Ensure an Exchange row exists for each target slug, creating a minimal
   * `supported: false` record when missing so TickerPairs FKs can resolve.
   */
  private async ensureTargetExchanges(): Promise<Exchange[]> {
    const existing = await this.exchangeRepo.find({ where: TARGET_EXCHANGE_SLUGS.map((slug) => ({ slug })) });
    const bySlug = new Map(existing.map((e) => [e.slug, e]));

    for (const meta of TARGET_EXCHANGE_METADATA) {
      if (bySlug.has(meta.slug)) continue;
      const entity = this.exchangeRepo.create({
        slug: meta.slug,
        name: meta.name,
        supported: false,
        isScraped: false,
        tickerPairsCount: 0
      });
      try {
        const saved = await this.exchangeRepo.save(entity);
        bySlug.set(meta.slug, saved);
        this.logger.log(`Created exchange row for ${meta.slug} (supported: false)`);
      } catch (error) {
        const err = toErrorInfo(error);
        this.logger.warn(`Failed to create exchange ${meta.slug}: ${err.message}`);
      }
    }
    return [...bySlug.values()];
  }

  /**
   * Try each identifier in order until one returns a non-empty ticker list.
   * The list is a defensive hook in case CoinGecko renames an exchange slug —
   * today every target has exactly one identifier.
   */
  private async fetchExchangeTickers(identifiers: readonly string[]): Promise<CachedTicker[]> {
    for (const identifier of identifiers) {
      const tickers = await this.tickerFetcher.fetchAllTickersForExchange(identifier);
      if (tickers.length > 0) return tickers;
    }
    return [];
  }

  /**
   * Keep the highest-`volume` ticker per coin. CoinGecko exchange feeds list the
   * same coin against multiple quote currencies — we only need one row per coin
   * per exchange for the scorer to count it as a cross-listing.
   */
  private selectHighestVolumePerCoin(
    tickers: CachedTicker[],
    coinBySlug: Map<string, Coin>
  ): Map<string, { coin: Coin; ticker: CachedTicker }> {
    const bestByCoin = new Map<string, { coin: Coin; ticker: CachedTicker }>();
    for (const ticker of tickers) {
      const coinId = ticker.coin_id?.toLowerCase();
      if (!coinId) continue;
      const coin = coinBySlug.get(coinId);
      if (!coin) continue;
      const target = typeof ticker.target === 'string' ? ticker.target : '';
      if (!target) continue;

      const current = bestByCoin.get(coin.id);
      if (!current || Number(ticker.volume ?? 0) > Number(current.ticker.volume ?? 0)) {
        bestByCoin.set(coin.id, { coin, ticker });
      }
    }
    return bestByCoin;
  }

  /**
   * Build (but do not persist) a ticker entity for bulk save. Returns either
   * a new entity (INSERT), a mutated existing one (UPDATE), or skip when the
   * ticker has no usable target quote asset.
   */
  private buildUpsertEntity(
    coin: Coin,
    ticker: CachedTicker,
    exchange: Exchange,
    existingBySymbol: Map<string, TickerPairs>
  ): { action: 'insert' | 'update' | 'skip'; entity?: TickerPairs } {
    const target = typeof ticker.target === 'string' ? ticker.target.toUpperCase() : '';
    if (!target) return { action: 'skip' };
    const symbol = `${coin.symbol.toUpperCase()}${target}`;

    const lastTraded = parseDate(ticker.last_traded_at) ?? new Date();
    const fetchAt = new Date();

    const existing = existingBySymbol.get(symbol);
    if (existing) {
      existing.volume = Number(ticker.volume ?? existing.volume);
      existing.tradeUrl = ticker.trade_url ?? existing.tradeUrl;
      existing.spreadPercentage = Number(ticker.bid_ask_spread_percentage ?? existing.spreadPercentage ?? 0);
      existing.lastTraded = lastTraded;
      existing.fetchAt = fetchAt;
      existing.status = TickerPairStatus.TRADING;
      return { action: 'update', entity: existing };
    }

    const entity = this.tickerRepo.create({
      exchange,
      baseAsset: coin,
      volume: Number(ticker.volume ?? 0),
      tradeUrl: ticker.trade_url,
      spreadPercentage: Number(ticker.bid_ask_spread_percentage ?? 0),
      lastTraded,
      fetchAt,
      status: TickerPairStatus.TRADING,
      isSpotTradingAllowed: true,
      isMarginTradingAllowed: false,
      isFiatPair: false
    });
    // No quoteAsset Coin available — entity hooks only auto-generate the symbol
    // when both base + quote Coin relations are set, so we set it explicitly.
    entity.symbol = symbol;
    return { action: 'insert', entity };
  }
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
