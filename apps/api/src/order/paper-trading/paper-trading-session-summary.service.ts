import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';
import { type QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import {
  PaperTradingOrder,
  PaperTradingOrderSide,
  PaperTradingSessionSummary,
  PaperTradingSignal,
  PaperTradingSignalDirection,
  PaperTradingSignalType,
  PaperTradingSymbolBreakdown
} from './entities';

@Injectable()
export class PaperTradingSessionSummaryService {
  private readonly logger = new Logger(PaperTradingSessionSummaryService.name);

  constructor(
    @InjectRepository(PaperTradingSessionSummary)
    private readonly summaryRepo: Repository<PaperTradingSessionSummary>,
    @InjectRepository(PaperTradingOrder) private readonly orderRepo: Repository<PaperTradingOrder>,
    @InjectRepository(PaperTradingSignal) private readonly signalRepo: Repository<PaperTradingSignal>
  ) {}

  async computeAndPersist(sessionId: string): Promise<void> {
    const [orders, signals] = await Promise.all([
      this.orderRepo
        .createQueryBuilder('o')
        .where('o.sessionId = :sessionId', { sessionId })
        .select(['o.id', 'o.side', 'o.symbol', 'o.totalValue', 'o.fee', 'o.slippageBps', 'o.realizedPnL'])
        .getMany(),
      this.signalRepo
        .createQueryBuilder('sig')
        .where('sig.sessionId = :sessionId', { sessionId })
        .select(['sig.id', 'sig.signalType', 'sig.direction', 'sig.confidence', 'sig.processed'])
        .getMany()
    ]);

    let totalOrders = 0;
    let buyCount = 0;
    let sellCount = 0;
    let totalVolume = 0;
    let totalFees = 0;
    let totalPnL = 0;
    let slippageSumBps = 0;
    let slippageCount = 0;

    const symbolMap = new Map<string, PaperTradingSymbolBreakdown>();

    for (const o of orders) {
      totalOrders += 1;
      if (o.side === PaperTradingOrderSide.BUY) buyCount += 1;
      else if (o.side === PaperTradingOrderSide.SELL) sellCount += 1;

      totalVolume += Number(o.totalValue) || 0;
      totalFees += Number(o.fee) || 0;
      totalPnL += Number(o.realizedPnL) || 0;

      if (typeof o.slippageBps === 'number' && Number.isFinite(o.slippageBps)) {
        slippageSumBps += o.slippageBps;
        slippageCount += 1;
      }

      const symbol = o.symbol ?? 'UNKNOWN';
      let sb = symbolMap.get(symbol);
      if (!sb) {
        sb = { symbol, orderCount: 0, totalVolume: 0, totalPnL: 0 };
        symbolMap.set(symbol, sb);
      }
      sb.orderCount += 1;
      sb.totalVolume += Number(o.totalValue) || 0;
      sb.totalPnL += Number(o.realizedPnL) || 0;
    }

    let totalSignals = 0;
    let processedCount = 0;
    let confidenceSum = 0;
    let confidenceCount = 0;
    const byType: Record<string, number> = {
      [PaperTradingSignalType.ENTRY]: 0,
      [PaperTradingSignalType.EXIT]: 0,
      [PaperTradingSignalType.ADJUSTMENT]: 0,
      [PaperTradingSignalType.RISK_CONTROL]: 0
    };
    const byDirection: Record<string, number> = {
      [PaperTradingSignalDirection.LONG]: 0,
      [PaperTradingSignalDirection.SHORT]: 0,
      [PaperTradingSignalDirection.FLAT]: 0
    };

    for (const s of signals) {
      totalSignals += 1;
      if (s.processed) processedCount += 1;
      if (typeof s.confidence === 'number' && Number.isFinite(s.confidence)) {
        confidenceSum += s.confidence;
        confidenceCount += 1;
      }
      byType[s.signalType] = (byType[s.signalType] ?? 0) + 1;
      byDirection[s.direction] = (byDirection[s.direction] ?? 0) + 1;
    }

    const avgSlippageBps = slippageCount > 0 ? slippageSumBps / slippageCount : null;

    const summary: Partial<PaperTradingSessionSummary> = {
      sessionId,
      totalOrders,
      buyCount,
      sellCount,
      totalVolume,
      totalFees,
      totalPnL,
      avgSlippageBps,
      slippageSumBps,
      slippageCount,
      totalSignals,
      processedCount,
      confidenceSum,
      confidenceCount,
      ordersBySymbol: Array.from(symbolMap.values()).sort((a, b) => b.totalVolume - a.totalVolume),
      signalsByType: byType,
      signalsByDirection: byDirection,
      computedAt: new Date()
    };

    await this.summaryRepo.upsert(summary as QueryDeepPartialEntity<PaperTradingSessionSummary>, {
      conflictPaths: ['sessionId'],
      skipUpdateIfNoValuesChanged: false
    });

    this.logger.debug(
      `Computed paper trading session summary for ${sessionId}: ${totalOrders} orders, ${totalSignals} signals`
    );
  }
}
