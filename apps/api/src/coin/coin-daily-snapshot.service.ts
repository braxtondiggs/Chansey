import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { LessThan, Repository } from 'typeorm';

import { CoinDailySnapshot } from './coin-daily-snapshot.entity';
import { Coin } from './coin.entity';

@Injectable()
export class CoinDailySnapshotService {
  private readonly logger = new Logger(CoinDailySnapshotService.name);
  private readonly DB_BATCH_SIZE = 500;

  constructor(
    @InjectRepository(CoinDailySnapshot)
    private readonly repo: Repository<CoinDailySnapshot>
  ) {}

  /**
   * Capture today's market data snapshot for the given coins.
   * Uses upsert to prevent duplicates if called multiple times on the same day.
   */
  async captureSnapshots(coins: Coin[]): Promise<number> {
    if (coins.length === 0) return 0;

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const snapshots = coins.map((coin) => ({
      coinId: coin.id,
      snapshotDate: today,
      marketCap: coin.marketCap ?? null,
      totalVolume: coin.totalVolume ?? null,
      currentPrice: coin.currentPrice ?? null,
      circulatingSupply: coin.circulatingSupply ?? null,
      marketRank: coin.marketRank ?? null
    }));

    let totalInserted = 0;

    for (let i = 0; i < snapshots.length; i += this.DB_BATCH_SIZE) {
      const batch = snapshots.slice(i, i + this.DB_BATCH_SIZE);
      const result = await this.repo
        .createQueryBuilder()
        .insert()
        .values(batch)
        .orUpdate(
          ['marketCap', 'totalVolume', 'currentPrice', 'circulatingSupply', 'marketRank'],
          ['coinId', 'snapshotDate']
        )
        .execute();

      totalInserted += result.identifiers.length;
    }

    return totalInserted;
  }

  /**
   * Get the closest snapshot on or before the given date for the specified coins.
   * Returns at most one snapshot per coin (the most recent one <= date).
   */
  async getSnapshotsAtDate(coinIds: string[], date: Date): Promise<CoinDailySnapshot[]> {
    if (coinIds.length === 0) return [];

    const dateStr = date.toISOString().split('T')[0];

    return this.repo
      .createQueryBuilder('s')
      .where('s.coinId IN (:...coinIds)', { coinIds })
      .andWhere('s.snapshotDate <= :date', { date: dateStr })
      .distinctOn(['s.coinId'])
      .orderBy('s.coinId')
      .addOrderBy('s.snapshotDate', 'DESC')
      .getMany();
  }

  /**
   * Filter coin IDs by historical quality: returns only coins that had
   * sufficient market cap and volume at (or near) the given date.
   */
  async getQualifiedCoinIdsAtDate(
    coinIds: string[],
    date: Date,
    minMarketCap = 100_000_000,
    minDailyVolume = 1_000_000
  ): Promise<string[]> {
    if (coinIds.length === 0) return [];

    const snapshots = await this.getSnapshotsAtDate(coinIds, date);

    return snapshots
      .filter(
        (s) =>
          s.marketCap != null &&
          Number(s.marketCap) >= minMarketCap &&
          s.totalVolume != null &&
          Number(s.totalVolume) >= minDailyVolume &&
          s.currentPrice != null
      )
      .map((s) => s.coinId);
  }

  /**
   * Backfill a single coin's snapshots from historical price data.
   * Uses CoinGecko's /coins/{id}/market_chart endpoint (365-day max on free tier).
   * Should be called once per coin, not on a recurring schedule.
   */
  async backfillFromHistoricalData(
    coinId: string,
    prices: { timestamp: number; price: number; volume: number; marketCap?: number }[]
  ): Promise<number> {
    if (prices.length === 0) return 0;

    const snapshots = prices.map((p) => ({
      coinId,
      snapshotDate: new Date(p.timestamp).toISOString().split('T')[0],
      marketCap: p.marketCap ?? null,
      totalVolume: p.volume,
      currentPrice: p.price,
      circulatingSupply: null,
      marketRank: null
    }));

    let totalInserted = 0;

    for (let i = 0; i < snapshots.length; i += this.DB_BATCH_SIZE) {
      const batch = snapshots.slice(i, i + this.DB_BATCH_SIZE);
      const result = await this.repo
        .createQueryBuilder()
        .insert()
        .values(batch)
        .orIgnore() // Don't overwrite existing snapshots
        .execute();

      totalInserted += result.identifiers.length;
    }

    return totalInserted;
  }

  /**
   * Find coins that have fewer than `minDays` snapshots, indicating they need backfill.
   */
  async getCoinsNeedingBackfill(coinIds: string[], minDays = 30): Promise<string[]> {
    if (coinIds.length === 0) return [];

    const results = await this.repo
      .createQueryBuilder('s')
      .select('s.coinId', 'coinId')
      .addSelect('COUNT(*)', 'cnt')
      .where('s.coinId IN (:...coinIds)', { coinIds })
      .groupBy('s.coinId')
      .getRawMany<{ coinId: string; cnt: string }>();

    const countMap = new Map(results.map((r) => [r.coinId, parseInt(r.cnt, 10)]));

    // Return coins with fewer than minDays snapshots (including coins with zero)
    return coinIds.filter((id) => (countMap.get(id) ?? 0) < minDays);
  }

  /**
   * Delete snapshots older than the given retention period.
   */
  async pruneOldSnapshots(retentionDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    const result = await this.repo.delete({
      snapshotDate: LessThan(cutoffStr)
    });

    return result.affected ?? 0;
  }

  /**
   * Get the total number of snapshots in the table.
   */
  async getSnapshotCount(): Promise<number> {
    return this.repo.count();
  }
}
