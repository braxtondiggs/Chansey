import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { UserActivityQueryDto } from './dto/filters.dto';
import { PaginatedUserActivityDto, UserActivityItemDto, UserAlgorithmSummaryDto } from './dto/user-activity.dto';
import { toInt, toNumber } from './live-trade-monitoring.utils';

import { AlgorithmActivation } from '../../algorithm/algorithm-activation.entity';
import { AlgorithmPerformance } from '../../algorithm/algorithm-performance.entity';
import { Order } from '../../order/order.entity';
import { User } from '../../users/users.entity';

interface UserOrderActivity {
  totalOrders: number;
  orders24h: number;
  orders7d: number;
  totalVolume: number;
  totalPnL: number;
  avgSlippageBps: number;
  lastOrderAt?: string;
}

@Injectable()
export class LiveTradeUserActivityService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(AlgorithmActivation)
    private readonly activationRepo: Repository<AlgorithmActivation>,
    @InjectRepository(AlgorithmPerformance)
    private readonly performanceRepo: Repository<AlgorithmPerformance>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>
  ) {}

  async getUserActivity(query: UserActivityQueryDto): Promise<PaginatedUserActivityDto> {
    const { page = 1, limit = 20, minActiveAlgorithms = 0, search } = query;
    const skip = (page - 1) * limit;

    const qb = this.userRepo
      .createQueryBuilder('u')
      .addSelect('u.createdAt')
      .innerJoin('algorithm_activations', 'aa', 'aa.userId = u.id')
      .groupBy('u.id')
      .having('COUNT(CASE WHEN aa."isActive" = true THEN 1 END) >= :minActive', { minActive: minActiveAlgorithms });

    if (search) {
      qb.andWhere('u.email ILIKE :search', { search: `%${search}%` });
    }

    const total = await qb.getCount();

    qb.orderBy('COUNT(CASE WHEN aa."isActive" = true THEN 1 END)', 'DESC').skip(skip).take(limit);

    const users = await qb.getMany();

    const userIds = users.map((u) => u.id);
    const [orderActivityMap, algorithmSummaryMap] = await Promise.all([
      this.getBatchUserOrderActivity(userIds),
      this.getBatchUserAlgorithmSummary(userIds)
    ]);

    const data: UserActivityItemDto[] = users.map((u) => {
      const activity = orderActivityMap.get(u.id) || {
        totalOrders: 0,
        orders24h: 0,
        orders7d: 0,
        totalVolume: 0,
        totalPnL: 0,
        avgSlippageBps: 0
      };
      const algorithms = algorithmSummaryMap.get(u.id) || [];

      return {
        userId: u.id,
        email: u.email,
        firstName: u.given_name,
        lastName: u.family_name,
        totalActivations: algorithms.length,
        activeAlgorithms: algorithms.filter((a) => a.isActive).length,
        totalOrders: activity.totalOrders,
        orders24h: activity.orders24h,
        orders7d: activity.orders7d,
        totalVolume: activity.totalVolume,
        totalPnL: activity.totalPnL,
        avgSlippageBps: activity.avgSlippageBps,
        registeredAt: u.createdAt.toISOString(),
        lastOrderAt: activity.lastOrderAt,
        algorithms
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

  private async getBatchUserOrderActivity(userIds: string[]): Promise<Map<string, UserOrderActivity>> {
    const map = new Map<string, UserOrderActivity>();
    if (userIds.length === 0) return map;

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const results = await this.orderRepo
      .createQueryBuilder('o')
      .select('o."userId"', 'userId')
      .addSelect('COUNT(*)', 'totalOrders')
      .addSelect(`COUNT(*) FILTER (WHERE o."createdAt" >= :oneDayAgo)`, 'orders24h')
      .addSelect(`COUNT(*) FILTER (WHERE o."createdAt" >= :sevenDaysAgo)`, 'orders7d')
      .addSelect('COALESCE(SUM(o.cost), 0)', 'totalVolume')
      .addSelect('COALESCE(SUM(o.gainLoss), 0)', 'totalPnL')
      .addSelect('COALESCE(AVG(o.actualSlippageBps), 0)', 'avgSlippageBps')
      .addSelect('MAX(o."createdAt")', 'lastOrderAt')
      .where('o."userId" IN (:...userIds)', { userIds })
      .andWhere('o.isAlgorithmicTrade = true')
      .setParameter('oneDayAgo', oneDayAgo)
      .setParameter('sevenDaysAgo', sevenDaysAgo)
      .groupBy('o."userId"')
      .getRawMany();

    for (const r of results) {
      map.set(r.userId, {
        totalOrders: toInt(r.totalOrders),
        orders24h: toInt(r.orders24h),
        orders7d: toInt(r.orders7d),
        totalVolume: toNumber(r.totalVolume),
        totalPnL: toNumber(r.totalPnL),
        avgSlippageBps: toNumber(r.avgSlippageBps),
        lastOrderAt: r.lastOrderAt ? new Date(r.lastOrderAt).toISOString() : undefined
      });
    }

    return map;
  }

  private async getBatchUserAlgorithmSummary(userIds: string[]): Promise<Map<string, UserAlgorithmSummaryDto[]>> {
    const map = new Map<string, UserAlgorithmSummaryDto[]>();
    if (userIds.length === 0) return map;

    const activations = await this.activationRepo.find({
      where: userIds.map((id) => ({ userId: id })),
      relations: ['algorithm']
    });

    if (activations.length === 0) return map;

    const activationIds = activations.map((aa) => aa.id);

    const orderCounts = await this.orderRepo
      .createQueryBuilder('o')
      .select('o.algorithmActivationId', 'activationId')
      .addSelect('COUNT(*)', 'orderCount')
      .where('o.algorithmActivationId IN (:...activationIds)', { activationIds })
      .andWhere('o.isAlgorithmicTrade = true')
      .groupBy('o.algorithmActivationId')
      .getRawMany();

    const orderCountMap = new Map<string, number>();
    for (const r of orderCounts) {
      orderCountMap.set(r.activationId, toInt(r.orderCount));
    }

    const performances = await this.performanceRepo
      .createQueryBuilder('ap')
      .where('ap.algorithmActivationId IN (:...activationIds)', { activationIds })
      .andWhere(
        'ap.calculatedAt = (SELECT MAX(ap2."calculatedAt") FROM algorithm_performances ap2 WHERE ap2."algorithmActivationId" = ap."algorithmActivationId")'
      )
      .getMany();

    const perfMap = new Map<string, AlgorithmPerformance>();
    for (const p of performances) {
      perfMap.set(p.algorithmActivationId, p);
    }

    for (const aa of activations) {
      const summary: UserAlgorithmSummaryDto = {
        activationId: aa.id,
        algorithmName: aa.algorithm?.name || 'Unknown',
        isActive: aa.isActive,
        totalOrders: orderCountMap.get(aa.id) || 0,
        roi: perfMap.get(aa.id)?.roi
      };

      const existing = map.get(aa.userId) || [];
      existing.push(summary);
      map.set(aa.userId, existing);
    }

    return map;
  }
}
