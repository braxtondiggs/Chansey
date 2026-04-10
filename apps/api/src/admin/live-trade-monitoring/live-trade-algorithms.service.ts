import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { AlgorithmActivationListItemDto, PaginatedAlgorithmListDto } from './dto/algorithms.dto';
import { AlgorithmListQueryDto, AlgorithmSortField, SortOrder } from './dto/filters.dto';
import {
  ALGORITHM_SORT_COLUMN_MAP,
  getDateRange,
  latestPerformanceCondition,
  toInt,
  toNumber
} from './live-trade-monitoring.utils';

import { AlgorithmActivation } from '../../algorithm/algorithm-activation.entity';
import { AlgorithmPerformance } from '../../algorithm/algorithm-performance.entity';
import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { Order } from '../../order/order.entity';

interface ActivationOrderStats {
  orders24h: number;
  totalVolume: number;
  avgSlippageBps: number;
}

@Injectable()
export class LiveTradeAlgorithmsService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(AlgorithmActivation)
    private readonly activationRepo: Repository<AlgorithmActivation>,
    @InjectRepository(ExchangeKey)
    private readonly exchangeKeyRepo: Repository<ExchangeKey>
  ) {}

  async getAlgorithms(query: AlgorithmListQueryDto): Promise<PaginatedAlgorithmListDto> {
    const {
      page = 1,
      limit = 20,
      sortBy = AlgorithmSortField.ACTIVATED_AT,
      sortOrder = SortOrder.DESC,
      search,
      isActive
    } = query;
    const skip = (page - 1) * limit;
    const dateRange = getDateRange(query);

    const qb = this.activationRepo
      .createQueryBuilder('aa')
      .leftJoinAndSelect('aa.algorithm', 'a')
      .leftJoinAndSelect('aa.user', 'u');
    qb.leftJoin(
      (subQuery) =>
        subQuery
          .select('ap2.algorithmActivationId', 'activationId')
          .addSelect('ap2.roi', 'roi')
          .addSelect('ap2.winRate', 'winRate')
          .addSelect('ap2.sharpeRatio', 'sharpeRatio')
          .addSelect('ap2.maxDrawdown', 'maxDrawdown')
          .from(AlgorithmPerformance, 'ap2')
          .where(latestPerformanceCondition('ap2', 'ap3')),
      'ap',
      'ap."activationId" = aa.id'
    );

    qb.addSelect(
      (subQuery) =>
        subQuery
          .select('COUNT(*)')
          .from(Order, 'o')
          .where('o.algorithmActivationId = aa.id')
          .andWhere('o.isAlgorithmicTrade = true'),
      'totalOrders'
    );

    if (query.algorithmId) {
      qb.andWhere('aa.algorithmId = :algorithmId', { algorithmId: query.algorithmId });
    }
    if (query.userId) {
      qb.andWhere('aa.userId = :userId', { userId: query.userId });
    }
    if (isActive !== undefined) {
      qb.andWhere('aa.isActive = :isActive', { isActive });
    }
    if (search) {
      qb.andWhere('a.name ILIKE :search', { search: `%${search}%` });
    }
    if (dateRange.startDate) {
      qb.andWhere('aa.activatedAt >= :startDate', { startDate: dateRange.startDate });
    }
    if (dateRange.endDate) {
      qb.andWhere('aa.activatedAt <= :endDate', { endDate: dateRange.endDate });
    }

    const total = await qb.getCount();

    const sortColumn = ALGORITHM_SORT_COLUMN_MAP[sortBy] || ALGORITHM_SORT_COLUMN_MAP[AlgorithmSortField.ACTIVATED_AT];
    if (sortBy === AlgorithmSortField.TOTAL_ORDERS) {
      qb.orderBy('totalOrders', sortOrder);
    } else {
      qb.orderBy(sortColumn, sortOrder);
    }

    qb.skip(skip).take(limit);

    const activations = await qb.getRawAndEntities();

    const activationIds = activations.entities.map((aa) => aa.id);
    const orderStatsMap = await this.getBatchActivationOrderStats(activationIds);

    const uniqueUserIds = [...new Set(activations.entities.map((aa) => aa.userId))];
    const exchangeNameMap = new Map<string, string>();
    if (uniqueUserIds.length > 0) {
      const userKeys = await this.exchangeKeyRepo.find({
        where: uniqueUserIds.map((uid) => ({ userId: uid, isActive: true })),
        relations: ['exchange']
      });
      for (const key of userKeys) {
        const name = key.exchange?.name;
        if (!name) continue;
        const existing = exchangeNameMap.get(key.userId);
        if (!existing) {
          exchangeNameMap.set(key.userId, name);
        } else if (!existing.includes(name)) {
          exchangeNameMap.set(key.userId, `${existing}, ${name}`);
        }
      }
    }

    const data: AlgorithmActivationListItemDto[] = activations.entities.map((aa, index) => {
      const raw = activations.raw[index];
      const orderStats = orderStatsMap.get(aa.id) || { orders24h: 0, totalVolume: 0, avgSlippageBps: 0 };

      return {
        id: aa.id,
        algorithmId: aa.algorithmId,
        algorithmName: aa.algorithm?.name || 'Unknown',
        userId: aa.userId,
        userEmail: aa.user?.email || 'Unknown',
        isActive: aa.isActive,
        allocationPercentage: Number(aa.allocationPercentage),
        activatedAt: aa.activatedAt?.toISOString(),
        deactivatedAt: aa.deactivatedAt?.toISOString(),
        totalOrders: toInt(raw.totalOrders),
        orders24h: orderStats.orders24h,
        totalVolume: orderStats.totalVolume,
        roi: raw.roi ? Number(raw.roi) : undefined,
        winRate: raw.winRate ? Number(raw.winRate) : undefined,
        sharpeRatio: raw.sharpeRatio ? Number(raw.sharpeRatio) : undefined,
        maxDrawdown: raw.maxDrawdown ? Number(raw.maxDrawdown) : undefined,
        avgSlippageBps: orderStats.avgSlippageBps,
        exchangeName: exchangeNameMap.get(aa.userId) || 'No exchanges',
        createdAt: aa.createdAt.toISOString()
      };
    });

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    };
  }

  private async getBatchActivationOrderStats(activationIds: string[]): Promise<Map<string, ActivationOrderStats>> {
    const map = new Map<string, ActivationOrderStats>();
    if (activationIds.length === 0) return map;

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const results = await this.orderRepo
      .createQueryBuilder('o')
      .select('o.algorithmActivationId', 'activationId')
      .addSelect('COALESCE(SUM(o.cost), 0)', 'totalVolume')
      .addSelect('COALESCE(AVG(o.actualSlippageBps), 0)', 'avgSlippageBps')
      .addSelect(`COUNT(*) FILTER (WHERE o."createdAt" >= :oneDayAgo)`, 'orders24h')
      .where('o.algorithmActivationId IN (:...activationIds)', { activationIds })
      .andWhere('o.isAlgorithmicTrade = true')
      .setParameter('oneDayAgo', oneDayAgo)
      .groupBy('o.algorithmActivationId')
      .getRawMany();

    for (const r of results) {
      map.set(r.activationId, {
        orders24h: toInt(r.orders24h),
        totalVolume: toNumber(r.totalVolume),
        avgSlippageBps: toNumber(r.avgSlippageBps)
      });
    }

    return map;
  }
}
