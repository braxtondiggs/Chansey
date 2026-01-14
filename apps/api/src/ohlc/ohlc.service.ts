import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, LessThan, Repository } from 'typeorm';

import { ExchangeSymbolMap } from './exchange-symbol-map.entity';
import {
  OHLCCandle,
  OHLCSummaryByPeriod,
  PriceSummary,
  PriceSummaryByDay,
  PriceSummaryByHour
} from './ohlc-candle.entity';

/**
 * Valid price range values for querying historical data
 */
export enum PriceRange {
  '30m' = '30m',
  '1h' = '1h',
  '6h' = '6h',
  '12h' = '12h',
  '1d' = '1d',
  '7d' = '7d',
  '14d' = '14d',
  '30d' = '30d',
  '90d' = '90d',
  '180d' = '180d',
  '1y' = '1y',
  '5y' = '5y',
  'all' = 'all'
}

/**
 * Time in milliseconds for each price range
 */
const PriceRangeTime: Record<string, number> = {
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '14d': 14 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '180d': 180 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
  '5y': 5 * 365 * 24 * 60 * 60 * 1000,
  all: 10 * 365 * 24 * 60 * 60 * 1000 // 10 years back
};

export interface GapInfo {
  start: Date;
  end: Date;
}

export interface SyncStatus {
  totalCandles: number;
  coinsWithData: number;
  oldestCandle: Date | null;
  newestCandle: Date | null;
  lastSyncTime: Date | null;
}

export interface GapSummary {
  coinId: string;
  gapCount: number;
  oldestGap: Date | null;
}

@Injectable()
export class OHLCService {
  private readonly logger = new Logger(OHLCService.name);

  constructor(
    @InjectRepository(OHLCCandle)
    private readonly ohlcRepository: Repository<OHLCCandle>,
    @InjectRepository(ExchangeSymbolMap)
    private readonly symbolMapRepository: Repository<ExchangeSymbolMap>
  ) {}

  // ==================== Core CRUD Operations ====================

  /**
   * Save multiple candles to the database
   */
  async saveCandles(candles: Partial<OHLCCandle>[]): Promise<void> {
    if (candles.length === 0) return;
    await this.ohlcRepository.insert(candles);
  }

  /**
   * Upsert candles - insert new or update existing based on unique constraint
   */
  async upsertCandles(candles: Partial<OHLCCandle>[]): Promise<void> {
    if (candles.length === 0) return;

    // Use upsert to handle conflicts on (coinId, timestamp, exchangeId)
    await this.ohlcRepository.upsert(candles, {
      conflictPaths: ['coinId', 'timestamp', 'exchangeId'],
      skipUpdateIfNoValuesChanged: true
    });
  }

  // ==================== Query Methods ====================

  /**
   * Get candles by date range with database-level filtering
   * This replaces the inefficient in-memory filtering in the backtest engine
   */
  async getCandlesByDateRange(coinIds: string[], startDate: Date, endDate: Date): Promise<OHLCCandle[]> {
    if (coinIds.length === 0) return [];

    return this.ohlcRepository
      .createQueryBuilder('candle')
      .where('candle.coinId IN (:...coinIds)', { coinIds })
      .andWhere('candle.timestamp >= :startDate', { startDate })
      .andWhere('candle.timestamp <= :endDate', { endDate })
      .orderBy('candle.timestamp', 'ASC')
      .getMany();
  }

  /**
   * Get candles grouped by coin for backtest compatibility
   */
  async getCandlesByDateRangeGrouped(coinIds: string[], startDate: Date, endDate: Date): Promise<OHLCSummaryByPeriod> {
    const candles = await this.getCandlesByDateRange(coinIds, startDate, endDate);

    return candles.reduce((acc, candle) => {
      if (!acc[candle.coinId]) {
        acc[candle.coinId] = [];
      }
      acc[candle.coinId].push({
        coinId: candle.coinId,
        timestamp: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume
      });
      return acc;
    }, {} as OHLCSummaryByPeriod);
  }

  /**
   * Get the latest candle for a coin
   */
  async getLatestCandle(coinId: string): Promise<OHLCCandle | null> {
    return this.ohlcRepository.findOne({
      where: { coinId },
      order: { timestamp: 'DESC' }
    });
  }

  /**
   * Get latest candles for multiple coins
   */
  async getLatestCandles(coinIds: string[]): Promise<Map<string, OHLCCandle>> {
    const result = new Map<string, OHLCCandle>();

    // Use a subquery to get the latest candle for each coin
    const latestCandles = await this.ohlcRepository
      .createQueryBuilder('candle')
      .distinctOn(['candle.coinId'])
      .where('candle.coinId IN (:...coinIds)', { coinIds })
      .orderBy('candle.coinId')
      .addOrderBy('candle.timestamp', 'DESC')
      .getMany();

    for (const candle of latestCandles) {
      result.set(candle.coinId, candle);
    }

    return result;
  }

  /**
   * Get total candle count
   */
  async getCandleCount(coinId?: string): Promise<number> {
    const where = coinId ? { coinId } : {};
    return this.ohlcRepository.count({ where });
  }

  /**
   * Get all unique coin IDs that have candle data
   */
  async getCoinsWithCandleData(): Promise<string[]> {
    const result = await this.ohlcRepository
      .createQueryBuilder('candle')
      .select('DISTINCT candle.coinId', 'coinId')
      .getRawMany();

    return result.map((row) => row.coinId).filter(Boolean);
  }

  /**
   * Get the date range of available candle data
   * @returns Object with start and end dates, or null if no data exists
   */
  async getCandleDataDateRange(): Promise<{ start: Date; end: Date } | null> {
    const result = await this.ohlcRepository
      .createQueryBuilder('candle')
      .select('MIN(candle.timestamp)', 'minDate')
      .addSelect('MAX(candle.timestamp)', 'maxDate')
      .getRawOne();

    if (!result?.minDate || !result?.maxDate) {
      return null;
    }

    return {
      start: new Date(result.minDate),
      end: new Date(result.maxDate)
    };
  }

  // ==================== Gap Detection ====================

  /**
   * Detect gaps in candle data for a coin within a date range
   * Returns array of gap periods where hourly candles are missing
   */
  async detectGaps(coinId: string, startDate: Date, endDate: Date): Promise<GapInfo[]> {
    const candles = await this.ohlcRepository
      .createQueryBuilder('candle')
      .select('candle.timestamp')
      .where('candle.coinId = :coinId', { coinId })
      .andWhere('candle.timestamp >= :startDate', { startDate })
      .andWhere('candle.timestamp <= :endDate', { endDate })
      .orderBy('candle.timestamp', 'ASC')
      .getMany();

    const gaps: GapInfo[] = [];
    const ONE_HOUR = 3600000;

    let expectedTime = startDate.getTime();

    for (const candle of candles) {
      const candleTime = candle.timestamp.getTime();

      // If gap is more than 1 hour
      if (candleTime - expectedTime > ONE_HOUR) {
        gaps.push({
          start: new Date(expectedTime),
          end: new Date(candleTime - ONE_HOUR)
        });
      }

      expectedTime = candleTime + ONE_HOUR;
    }

    // Check for gap at the end
    if (expectedTime < endDate.getTime()) {
      gaps.push({
        start: new Date(expectedTime),
        end: endDate
      });
    }

    return gaps;
  }

  /**
   * Get gap summary for all coins with data
   */
  async getGapSummary(): Promise<GapSummary[]> {
    // Get all unique coin IDs with candles
    const coinsWithData = await this.ohlcRepository
      .createQueryBuilder('candle')
      .select('DISTINCT candle.coinId', 'coinId')
      .getRawMany();

    const summaries: GapSummary[] = [];
    const now = new Date();
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    for (const { coinId } of coinsWithData) {
      const gaps = await this.detectGaps(coinId, oneYearAgo, now);
      summaries.push({
        coinId,
        gapCount: gaps.length,
        oldestGap: gaps.length > 0 ? gaps[0].start : null
      });
    }

    return summaries.filter((s) => s.gapCount > 0);
  }

  // ==================== Symbol Map Operations ====================

  /**
   * Get all active symbol mappings, optionally filtered by exchange
   */
  async getActiveSymbolMaps(exchangeId?: string): Promise<ExchangeSymbolMap[]> {
    const where: Partial<ExchangeSymbolMap> = { isActive: true };
    if (exchangeId) {
      where.exchangeId = exchangeId;
    }

    return this.symbolMapRepository.find({
      where,
      order: { priority: 'ASC' },
      relations: ['coin', 'exchange']
    });
  }

  /**
   * Get symbol mappings for specific coins
   */
  async getSymbolMapsForCoins(coinIds: string[]): Promise<ExchangeSymbolMap[]> {
    if (coinIds.length === 0) return [];

    return this.symbolMapRepository.find({
      where: {
        coinId: In(coinIds),
        isActive: true
      },
      order: { priority: 'ASC' },
      relations: ['coin', 'exchange']
    });
  }

  /**
   * Create or update a symbol mapping
   */
  async upsertSymbolMap(mapping: Partial<ExchangeSymbolMap>): Promise<ExchangeSymbolMap> {
    const existing = await this.symbolMapRepository.findOne({
      where: {
        coinId: mapping.coinId,
        exchangeId: mapping.exchangeId
      }
    });

    if (existing) {
      await this.symbolMapRepository.update(existing.id, mapping);
      return { ...existing, ...mapping } as ExchangeSymbolMap;
    }

    const created = this.symbolMapRepository.create(mapping);
    return this.symbolMapRepository.save(created);
  }

  /**
   * Update symbol map status
   */
  async updateSymbolMapStatus(id: string, isActive: boolean): Promise<void> {
    await this.symbolMapRepository.update(id, { isActive });
  }

  /**
   * Increment failure count for a symbol mapping
   */
  async incrementFailureCount(id: string): Promise<void> {
    await this.symbolMapRepository.increment({ id }, 'failureCount', 1);
  }

  /**
   * Reset failure count and update last sync time
   */
  async markSyncSuccess(id: string): Promise<void> {
    await this.symbolMapRepository.update(id, {
      failureCount: 0,
      lastSyncAt: new Date()
    });
  }

  // ==================== Pruning ====================

  /**
   * Delete candles older than the specified retention period
   * @returns Number of deleted candles
   */
  async pruneOldCandles(retentionDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await this.ohlcRepository.delete({
      timestamp: LessThan(cutoffDate)
    });

    this.logger.log(`Pruned ${result.affected} candles older than ${cutoffDate.toISOString()}`);
    return result.affected || 0;
  }

  // ==================== Sync Status ====================

  /**
   * Get overall sync status for health monitoring
   */
  async getSyncStatus(): Promise<SyncStatus> {
    const [totalCandles, coinsWithDataResult, oldestCandle, newestCandle, lastSyncResult] = await Promise.all([
      this.ohlcRepository.count(),
      this.ohlcRepository.createQueryBuilder('candle').select('COUNT(DISTINCT candle.coinId)', 'count').getRawOne(),
      this.ohlcRepository.findOne({
        order: { timestamp: 'ASC' },
        select: ['timestamp']
      }),
      this.ohlcRepository.findOne({
        order: { timestamp: 'DESC' },
        select: ['timestamp']
      }),
      this.symbolMapRepository.findOne({
        where: { isActive: true },
        order: { lastSyncAt: 'DESC' },
        select: ['lastSyncAt']
      })
    ]);

    return {
      totalCandles,
      coinsWithData: parseInt(coinsWithDataResult?.count || '0', 10),
      oldestCandle: oldestCandle?.timestamp || null,
      newestCandle: newestCandle?.timestamp || null,
      lastSyncTime: lastSyncResult?.lastSyncAt || null
    };
  }

  /**
   * Get stale coins (coins that haven't been synced recently)
   */
  async getStaleCoins(staleThresholdHours = 2): Promise<ExchangeSymbolMap[]> {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - staleThresholdHours);

    return this.symbolMapRepository
      .createQueryBuilder('mapping')
      .where('mapping.isActive = true')
      .andWhere('(mapping.lastSyncAt IS NULL OR mapping.lastSyncAt < :cutoffDate)', { cutoffDate })
      .leftJoinAndSelect('mapping.coin', 'coin')
      .leftJoinAndSelect('mapping.exchange', 'exchange')
      .getMany();
  }

  // ==================== Price Compatibility Methods ====================

  /**
   * Get price data aggregated by day - compatible with legacy PriceService interface.
   * Used by algorithm strategies that expect PriceSummary format.
   *
   * @param coins - Single coin ID or array of coin IDs
   * @param range - Time range (e.g., '7d', '30d', '1y', 'all')
   * @returns Price data grouped by coin ID
   */
  async findAllByDay(coins: string[] | string, range = 'all'): Promise<PriceSummaryByDay> {
    const coinIds = Array.isArray(coins) ? coins : [coins];
    const { startDate, endDate } = this.parseDateRange(range);

    const candles = await this.getCandlesByDateRange(coinIds, startDate, endDate);

    // Group candles by day and coin
    return this.aggregateCandlesToPriceSummary(candles, (candle) => candle.timestamp.toISOString().split('T')[0]);
  }

  /**
   * Get price data aggregated by hour - compatible with legacy PriceService interface.
   * Since OHLC data is already hourly, this returns candles directly converted to PriceSummary.
   *
   * @param coins - Single coin ID or array of coin IDs
   * @param range - Time range (e.g., '7d', '30d', '1y', 'all')
   * @returns Price data grouped by coin ID
   */
  async findAllByHour(coins: string[] | string, range = 'all'): Promise<PriceSummaryByHour> {
    const coinIds = Array.isArray(coins) ? coins : [coins];
    const { startDate, endDate } = this.parseDateRange(range);

    const candles = await this.getCandlesByDateRange(coinIds, startDate, endDate);

    // Group candles by hour and coin (hourly key)
    return this.aggregateCandlesToPriceSummary(
      candles,
      (candle) => `${candle.timestamp.toISOString().split('T')[0]}-${candle.timestamp.getHours()}`
    );
  }

  /**
   * Parse a date range string into start and end dates.
   */
  private parseDateRange(range: string): { startDate: Date; endDate: Date } {
    const endDate = new Date();
    const timeMs = PriceRangeTime[range] || PriceRangeTime['all'];
    const startDate = new Date(endDate.getTime() - timeMs);

    return { startDate, endDate };
  }

  /**
   * Convert OHLC candles to PriceSummary format, grouped by a key function.
   * This aggregates multiple candles within the same period (e.g., day).
   */
  private aggregateCandlesToPriceSummary(
    candles: OHLCCandle[],
    keyFn: (candle: OHLCCandle) => string
  ): PriceSummaryByDay {
    // Group candles by key-coinId
    const grouped = candles.reduce(
      (acc, candle) => {
        const key = `${keyFn(candle)}-${candle.coinId}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(candle);
        return acc;
      },
      {} as Record<string, OHLCCandle[]>
    );

    // Aggregate each group into PriceSummary
    const summaries = Object.entries(grouped).map(([, groupCandles]) => {
      const [first] = groupCandles;
      const highs = groupCandles.map((c) => c.high);
      const lows = groupCandles.map((c) => c.low);
      const closes = groupCandles.map((c) => c.close);
      const volumes = groupCandles.map((c) => c.volume);

      return {
        date: first.timestamp,
        high: Math.max(...highs),
        low: Math.min(...lows),
        avg: +(closes.reduce((sum, c) => sum + c, 0) / closes.length).toFixed(8),
        coin: first.coinId,
        open: groupCandles[0].open,
        close: groupCandles[groupCandles.length - 1].close,
        volume: volumes.reduce((sum, v) => sum + v, 0)
      } as PriceSummary;
    });

    // Group by coinId
    return summaries
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .reduce((acc, summary) => {
        if (!acc[summary.coin]) acc[summary.coin] = [];
        acc[summary.coin].push(summary);
        return acc;
      }, {} as PriceSummaryByDay);
  }
}
