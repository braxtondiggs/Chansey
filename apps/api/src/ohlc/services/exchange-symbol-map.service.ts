import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, type QueryDeepPartialEntity, Repository } from 'typeorm';

import { ExchangeSymbolMap } from '../exchange-symbol-map.entity';

@Injectable()
export class ExchangeSymbolMapService {
  constructor(
    @InjectRepository(ExchangeSymbolMap)
    private readonly symbolMapRepository: Repository<ExchangeSymbolMap>
  ) {}

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
   * Create or update a symbol mapping.
   * Looks up by coinId only so a coin can be remapped to a different exchange.
   */
  async upsertSymbolMap(mapping: Partial<ExchangeSymbolMap>): Promise<ExchangeSymbolMap> {
    const existing = await this.symbolMapRepository.findOne({
      where: { coinId: mapping.coinId }
    });

    if (existing) {
      await this.symbolMapRepository.update(existing.id, mapping as QueryDeepPartialEntity<ExchangeSymbolMap>);
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
   * Deactivate mappings that have never synced successfully and exceed a failure threshold.
   * Returns the number of deactivated mappings.
   */
  async deactivateFailedMappings(minFailures: number): Promise<number> {
    const result = await this.symbolMapRepository
      .createQueryBuilder()
      .update(ExchangeSymbolMap)
      .set({ isActive: false })
      .where('lastSyncAt IS NULL')
      .andWhere('failureCount >= :minFailures', { minFailures })
      .andWhere('isActive = true')
      .execute();

    return result.affected || 0;
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

  /**
   * Get the most recent sync time across all active symbol maps
   */
  async getLastSyncTime(): Promise<Date | null> {
    const result = await this.symbolMapRepository.findOne({
      where: { isActive: true },
      order: { lastSyncAt: 'DESC' },
      select: ['lastSyncAt']
    });

    return result?.lastSyncAt || null;
  }
}
