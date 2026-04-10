import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { ExportFormat } from './dto/backtest-listing.dto';
import { BacktestFiltersDto } from './dto/overview.dto';
import { applyBacktestFilters, getDateRange, resolveInstrumentSymbols } from './monitoring-shared.util';

import { Coin } from '../../coin/coin.entity';
import { BacktestSignal } from '../../order/backtest/backtest-signal.entity';
import { BacktestTrade } from '../../order/backtest/backtest-trade.entity';
import { Backtest } from '../../order/backtest/backtest.entity';
import { MAX_EXPORT_LIMIT } from '../constants';
import { convertToCsv } from '../utils/csv.util';

@Injectable()
export class MonitoringExportService {
  private readonly logger = new Logger(MonitoringExportService.name);

  constructor(
    @InjectRepository(Backtest) private readonly backtestRepo: Repository<Backtest>,
    @InjectRepository(BacktestTrade) private readonly tradeRepo: Repository<BacktestTrade>,
    @InjectRepository(BacktestSignal) private readonly signalRepo: Repository<BacktestSignal>,
    @InjectRepository(Coin) private readonly coinRepo: Repository<Coin>
  ) {}

  /**
   * Export backtests as CSV or JSON
   *
   * Note: Limited to MAX_EXPORT_LIMIT records to prevent DoS
   */
  async exportBacktests(filters: BacktestFiltersDto, format: ExportFormat): Promise<Buffer | object[]> {
    const dateRange = getDateRange(filters);

    const qb = this.backtestRepo.createQueryBuilder('b').leftJoinAndSelect('b.algorithm', 'a');

    applyBacktestFilters(qb, filters, dateRange);
    qb.orderBy('b.createdAt', 'DESC').take(MAX_EXPORT_LIMIT);

    const [backtests, total] = await qb.getManyAndCount();

    if (total > MAX_EXPORT_LIMIT) {
      this.logger.warn(`Export truncated: ${total} matched, returning ${MAX_EXPORT_LIMIT}`);
    }

    const data = backtests.map((b) => ({
      id: b.id,
      name: b.name,
      status: b.status,
      type: b.type,
      algorithmName: b.algorithm?.name || '',
      initialCapital: b.initialCapital,
      finalValue: b.finalValue,
      totalReturn: b.totalReturn,
      sharpeRatio: b.sharpeRatio,
      maxDrawdown: b.maxDrawdown,
      totalTrades: b.totalTrades,
      winRate: b.winRate,
      startDate: b.startDate.toISOString(),
      endDate: b.endDate.toISOString(),
      createdAt: b.createdAt.toISOString(),
      completedAt: b.completedAt?.toISOString() || ''
    }));

    if (format === ExportFormat.JSON) {
      return data;
    }

    return convertToCsv(data);
  }

  /**
   * Export signals for a specific backtest
   */
  async exportSignals(backtestId: string, format: ExportFormat): Promise<Buffer | object[]> {
    const backtestExists = await this.backtestRepo.existsBy({ id: backtestId });
    if (!backtestExists) {
      throw new NotFoundException(`Backtest with ID '${backtestId}' not found`);
    }

    const signals = await this.signalRepo.find({
      where: { backtest: { id: backtestId } },
      order: { timestamp: 'ASC' }
    });

    const data = signals.map((s) => ({
      id: s.id,
      timestamp: s.timestamp.toISOString(),
      signalType: s.signalType,
      instrument: s.instrument?.toUpperCase() || s.instrument,
      direction: s.direction,
      quantity: s.quantity,
      price: s.price,
      confidence: s.confidence,
      reason: s.reason
    }));

    // Resolve instrument UUIDs to coin symbols
    const instrumentSet = new Set(data.map((d) => d.instrument).filter(Boolean) as string[]);
    const resolver = await resolveInstrumentSymbols(this.coinRepo, instrumentSet);
    for (const item of data) {
      if (item.instrument) {
        item.instrument = resolver.resolve(item.instrument) ?? item.instrument;
      }
    }

    if (format === ExportFormat.JSON) {
      return data;
    }

    return convertToCsv(data);
  }

  /**
   * Export trades for a specific backtest
   */
  async exportTrades(backtestId: string, format: ExportFormat): Promise<Buffer | object[]> {
    const backtestExists = await this.backtestRepo.existsBy({ id: backtestId });
    if (!backtestExists) {
      throw new NotFoundException(`Backtest with ID '${backtestId}' not found`);
    }

    const trades = await this.tradeRepo.find({
      where: { backtest: { id: backtestId } },
      relations: ['baseCoin', 'quoteCoin'],
      order: { executedAt: 'ASC' }
    });

    const data = trades.map((t) => ({
      id: t.id,
      type: t.type,
      status: t.status,
      quantity: t.quantity,
      price: t.price,
      totalValue: t.totalValue,
      fee: t.fee,
      realizedPnL: t.realizedPnL,
      realizedPnLPercent: t.realizedPnLPercent,
      executedAt: t.executedAt.toISOString(),
      baseCoin: t.baseCoin?.symbol || '',
      quoteCoin: t.quoteCoin?.symbol || '',
      signal: t.signal
    }));

    if (format === ExportFormat.JSON) {
      return data;
    }

    return convertToCsv(data);
  }
}
