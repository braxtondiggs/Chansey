import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { BacktestSignalCollection, SimulatedOrderFillCollection } from '@chansey/api-interfaces';

import { BacktestCoreRepository } from './backtest-core-repository.service';
import { wrapInternal } from './backtest-error.util';
import { BacktestMapper } from './backtest-mapper.service';
import { BacktestPerformanceSnapshot } from './backtest-performance-snapshot.entity';
import { BacktestSignal as BacktestSignalEntity } from './backtest-signal.entity';
import { BacktestTrade } from './backtest-trade.entity';
import { BacktestStatus } from './backtest.entity';
import { BacktestPerformanceDto, BacktestSignalQueryDto, BacktestTradesQueryDto } from './dto/backtest.dto';
import { SimulatedOrderFill as SimulatedOrderFillEntity } from './simulated-order-fill.entity';

import { User } from '../../users/users.entity';

@Injectable()
export class BacktestQueryService {
  private readonly logger = new Logger(BacktestQueryService.name);

  constructor(
    private readonly coreRepository: BacktestCoreRepository,
    private readonly mapper: BacktestMapper,
    @InjectRepository(BacktestTrade) private readonly backtestTradeRepository: Repository<BacktestTrade>,
    @InjectRepository(BacktestPerformanceSnapshot)
    private readonly backtestSnapshotRepository: Repository<BacktestPerformanceSnapshot>,
    @InjectRepository(BacktestSignalEntity) private readonly backtestSignalRepository: Repository<BacktestSignalEntity>,
    @InjectRepository(SimulatedOrderFillEntity)
    private readonly simulatedFillRepository: Repository<SimulatedOrderFillEntity>
  ) {}

  async getBacktestSignals(
    user: User,
    backtestId: string,
    options: BacktestSignalQueryDto = {}
  ): Promise<BacktestSignalCollection> {
    await this.coreRepository.ensureRunOwnership(user, backtestId);

    const pageSize = this.mapper.clampPageSize(options.pageSize ?? 100);

    const query = this.backtestSignalRepository
      .createQueryBuilder('signal')
      .where('signal.backtestId = :backtestId', { backtestId })
      .orderBy('signal.timestamp', 'ASC')
      .addOrderBy('signal.id', 'ASC')
      .take(pageSize + 1);

    if (options.cursor) {
      const cursor = this.mapper.decodeCursor(options.cursor);
      if (cursor?.timestamp && cursor?.id) {
        query.andWhere('(signal.timestamp > :cursorTs OR (signal.timestamp = :cursorTs AND signal.id > :cursorId))', {
          cursorTs: new Date(cursor.timestamp),
          cursorId: cursor.id
        });
      }
    }

    if (options.instrument) {
      query.andWhere('signal.instrument = :instrument', { instrument: options.instrument });
    }

    if (options.signalType) {
      query.andWhere('signal.signalType = :signalType', { signalType: options.signalType });
    }

    if (options.direction) {
      query.andWhere('signal.direction = :direction', { direction: options.direction });
    }

    const entities = await query.getMany();
    const hasMore = entities.length > pageSize;
    const items = hasMore ? entities.slice(0, pageSize) : entities;

    return {
      items: items.map((signal) => this.mapper.mapSignal(signal, backtestId)),
      nextCursor: hasMore
        ? this.mapper.encodeCursor(items[items.length - 1].timestamp, items[items.length - 1].id, 'timestamp')
        : undefined
    };
  }

  async getBacktestTrades(
    user: User,
    backtestId: string,
    options: BacktestTradesQueryDto = {}
  ): Promise<SimulatedOrderFillCollection> {
    await this.coreRepository.ensureRunOwnership(user, backtestId);

    const pageSize = this.mapper.clampPageSize(options.pageSize ?? 100);
    const query = this.simulatedFillRepository
      .createQueryBuilder('fill')
      .where('fill.backtestId = :backtestId', { backtestId })
      .orderBy('fill.executionTimestamp', 'ASC')
      .addOrderBy('fill.id', 'ASC')
      .take(pageSize + 1);

    if (options.cursor) {
      const cursor = this.mapper.decodeCursor(options.cursor);
      if (cursor?.timestamp && cursor?.id) {
        query.andWhere(
          '(fill.executionTimestamp > :cursorTs OR (fill.executionTimestamp = :cursorTs AND fill.id > :cursorId))',
          {
            cursorTs: new Date(cursor.timestamp),
            cursorId: cursor.id
          }
        );
      }
    }

    if (options.instrument) {
      query.andWhere('fill.instrument = :instrument', { instrument: options.instrument });
    }

    if (options.orderType) {
      query.andWhere('fill.orderType = :orderType', { orderType: options.orderType });
    }

    if (options.status) {
      query.andWhere('fill.status = :status', { status: options.status });
    }

    const entities = await query.getMany();
    const hasMore = entities.length > pageSize;
    const items = hasMore ? entities.slice(0, pageSize) : entities;

    return {
      items: items.map((fill) => this.mapper.mapSimulatedFill(fill, backtestId)),
      nextCursor: hasMore
        ? this.mapper.encodeCursor(items[items.length - 1].executionTimestamp, items[items.length - 1].id, 'timestamp')
        : undefined
    };
  }

  /**
   * Get backtest performance metrics
   */
  async getBacktestPerformance(user: User, backtestId: string): Promise<BacktestPerformanceDto> {
    return wrapInternal(this.logger, `Failed to get backtest performance ${backtestId}`, async () => {
      const backtest = await this.coreRepository.fetchWithStandardRelations(user, backtestId);

      if (backtest.status !== BacktestStatus.COMPLETED) {
        throw new BadRequestException('Backtest must be completed to view performance');
      }

      // Get recent trades (last 50)
      const recentTrades = await this.backtestTradeRepository.find({
        where: { backtest: { id: backtestId } },
        relations: ['baseCoin', 'quoteCoin'],
        order: { executedAt: 'DESC' },
        take: 50
      });

      // Get performance history
      const snapshots = await this.backtestSnapshotRepository.find({
        where: { backtest: { id: backtestId } },
        order: { timestamp: 'ASC' }
      });

      return {
        backtestId: backtest.id,
        name: backtest.name,
        initialCapital: backtest.initialCapital,
        finalValue: backtest.finalValue || 0,
        totalReturn: backtest.totalReturn || 0,
        annualizedReturn: backtest.annualizedReturn || 0,
        sharpeRatio: backtest.sharpeRatio || 0,
        maxDrawdown: backtest.maxDrawdown || 0,
        totalTrades: backtest.totalTrades || 0,
        winningTrades: backtest.winningTrades || 0,
        winRate: backtest.winRate || 0,
        performanceHistory: snapshots.map((snapshot) => this.mapper.mapPerformanceSnapshot(snapshot)),
        recentTrades: recentTrades.map((trade) => ({
          id: trade.id,
          type: trade.type,
          quantity: trade.quantity,
          price: trade.price,
          totalValue: trade.totalValue,
          executedAt: trade.executedAt,
          baseCoin: { symbol: trade.baseCoin?.symbol, name: trade.baseCoin?.name },
          quoteCoin: { symbol: trade.quoteCoin?.symbol, name: trade.quoteCoin?.name }
        }))
      };
    });
  }
}
