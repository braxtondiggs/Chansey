import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, SelectQueryBuilder } from 'typeorm';

import { ExportFormat, OrderListQueryDto, OrderSortField, SortOrder } from './dto/filters.dto';
import { AlgorithmicOrderListItemDto, PaginatedOrderListDto } from './dto/orders.dto';
import {
  MAX_EXPORT_LIMIT,
  ORDER_SORT_COLUMN_MAP,
  convertToCsv,
  getDateRange,
  toNumber
} from './live-trade-monitoring.utils';

import { Order } from '../../order/order.entity';

interface OrderAggregates {
  totalVolume: number;
  totalPnL: number;
  avgSlippageBps: number;
}

export interface OrderExportPayload {
  contentType: string;
  filename: string;
  body: Buffer | object[];
}

@Injectable()
export class LiveTradeOrdersService {
  private readonly logger = new Logger(LiveTradeOrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>
  ) {}

  async getOrders(query: OrderListQueryDto): Promise<PaginatedOrderListDto> {
    const { page = 1, limit = 20, sortBy = OrderSortField.CREATED_AT, sortOrder = SortOrder.DESC } = query;
    const skip = (page - 1) * limit;

    const qb = this.buildOrdersQueryBuilder(query);

    const [total, aggregates] = await Promise.all([qb.getCount(), this.getOrderAggregates(qb.clone())]);

    const sortColumn = ORDER_SORT_COLUMN_MAP[sortBy] || ORDER_SORT_COLUMN_MAP[OrderSortField.CREATED_AT];
    qb.orderBy(sortColumn, sortOrder).skip(skip).take(limit);

    const orders = await qb.getMany();

    const data: AlgorithmicOrderListItemDto[] = orders.map((o) => ({
      id: o.id,
      symbol: o.symbol,
      orderId: o.orderId,
      side: o.side,
      type: o.type,
      status: o.status,
      quantity: o.quantity,
      price: o.price,
      executedQuantity: o.executedQuantity,
      cost: o.cost,
      averagePrice: o.averagePrice,
      expectedPrice: o.expectedPrice,
      actualSlippageBps: o.actualSlippageBps,
      fee: o.fee,
      gainLoss: o.gainLoss,
      algorithmActivationId: o.algorithmActivationId || '',
      algorithmName: o.algorithmActivation?.algorithm?.name || 'Unknown',
      userId: o.user?.id || '',
      userEmail: o.user?.email || 'Unknown',
      exchangeName: o.exchange?.name || 'Unknown',
      transactTime: o.transactTime.toISOString(),
      createdAt: o.createdAt.toISOString()
    }));

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      totalVolume: aggregates.totalVolume,
      totalPnL: aggregates.totalPnL,
      avgSlippageBps: aggregates.avgSlippageBps
    };
  }

  async exportOrders(query: OrderListQueryDto, format: ExportFormat): Promise<OrderExportPayload> {
    const { sortBy = OrderSortField.CREATED_AT, sortOrder = SortOrder.DESC } = query;

    const qb = this.buildOrdersQueryBuilder(query);
    const sortColumn = ORDER_SORT_COLUMN_MAP[sortBy] || ORDER_SORT_COLUMN_MAP[OrderSortField.CREATED_AT];
    qb.orderBy(sortColumn, sortOrder).take(MAX_EXPORT_LIMIT);

    const orders = await qb.getMany();

    if (orders.length === MAX_EXPORT_LIMIT) {
      this.logger.warn(`Export truncated to ${MAX_EXPORT_LIMIT} records`);
    }

    const data = orders.map((o) => ({
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      status: o.status,
      quantity: o.quantity,
      price: o.price,
      executedQuantity: o.executedQuantity,
      cost: o.cost || 0,
      actualSlippageBps: o.actualSlippageBps || 0,
      fee: o.fee,
      gainLoss: o.gainLoss || 0,
      algorithmName: o.algorithmActivation?.algorithm?.name || '',
      userEmail: o.user?.email || '',
      exchangeName: o.exchange?.name || '',
      transactTime: o.transactTime.toISOString(),
      createdAt: o.createdAt.toISOString()
    }));

    if (format === ExportFormat.JSON) {
      return {
        contentType: 'application/json',
        filename: 'algorithmic-orders.json',
        body: data
      };
    }

    return {
      contentType: 'text/csv',
      filename: 'algorithmic-orders.csv',
      body: convertToCsv(data)
    };
  }

  private buildOrdersQueryBuilder(query: OrderListQueryDto): SelectQueryBuilder<Order> {
    const dateRange = getDateRange(query);

    const qb = this.orderRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.user', 'u')
      .leftJoinAndSelect('o.exchange', 'ex')
      .leftJoinAndSelect('o.algorithmActivation', 'aa')
      .leftJoin('aa.algorithm', 'a')
      .addSelect(['a.id', 'a.name'])
      .where('o.isAlgorithmicTrade = true');

    if (query.algorithmId) {
      qb.andWhere('a.id = :algorithmId', { algorithmId: query.algorithmId });
    }
    if (query.userId) {
      qb.andWhere('o.user.id = :userId', { userId: query.userId });
    }
    if (query.algorithmActivationId) {
      qb.andWhere('o.algorithmActivationId = :algorithmActivationId', {
        algorithmActivationId: query.algorithmActivationId
      });
    }
    if (query.symbol) {
      qb.andWhere('o.symbol = :symbol', { symbol: query.symbol });
    }
    if (dateRange.startDate) {
      qb.andWhere('o.createdAt >= :startDate', { startDate: dateRange.startDate });
    }
    if (dateRange.endDate) {
      qb.andWhere('o.createdAt <= :endDate', { endDate: dateRange.endDate });
    }

    return qb;
  }

  private async getOrderAggregates(qb: SelectQueryBuilder<Order>): Promise<OrderAggregates> {
    const result = await qb
      .select('COALESCE(SUM(o.cost), 0)', 'totalVolume')
      .addSelect('COALESCE(SUM(o.gainLoss), 0)', 'totalPnL')
      .addSelect('COALESCE(AVG(o.actualSlippageBps), 0)', 'avgSlippageBps')
      .getRawOne();

    return {
      totalVolume: toNumber(result?.totalVolume),
      totalPnL: toNumber(result?.totalPnL),
      avgSlippageBps: toNumber(result?.avgSlippageBps)
    };
  }
}
