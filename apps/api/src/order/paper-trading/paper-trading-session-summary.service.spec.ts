import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type ObjectLiteral, type Repository, type SelectQueryBuilder } from 'typeorm';

import {
  PaperTradingOrder,
  PaperTradingOrderSide,
  PaperTradingOrderStatus,
  PaperTradingOrderType
} from './entities/paper-trading-order.entity';
import { PaperTradingSessionSummary } from './entities/paper-trading-session-summary.entity';
import {
  PaperTradingSignal,
  PaperTradingSignalDirection,
  PaperTradingSignalStatus,
  PaperTradingSignalType
} from './entities/paper-trading-signal.entity';
import { PaperTradingSessionSummaryService } from './paper-trading-session-summary.service';

type MockRepo<T extends ObjectLiteral> = Partial<jest.Mocked<Repository<T>>>;

const qbReturning = (rows: any[]) => {
  const qb: Partial<SelectQueryBuilder<any>> = {
    where: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows)
  };
  return qb as SelectQueryBuilder<any>;
};

function makeOrder(partial: Partial<PaperTradingOrder>): PaperTradingOrder {
  const o = new PaperTradingOrder({
    side: PaperTradingOrderSide.BUY,
    orderType: PaperTradingOrderType.MARKET,
    status: PaperTradingOrderStatus.FILLED,
    symbol: 'BTC/USD',
    baseCurrency: 'BTC',
    quoteCurrency: 'USD',
    requestedQuantity: 1,
    filledQuantity: 1,
    fee: 0.1,
    totalValue: 100
  });
  Object.assign(o, partial);
  return o;
}

function makeSignal(partial: Partial<PaperTradingSignal>): PaperTradingSignal {
  const s = new PaperTradingSignal({
    signalType: PaperTradingSignalType.ENTRY,
    direction: PaperTradingSignalDirection.LONG,
    instrument: 'BTC/USD',
    quantity: 1,
    processed: false,
    status: PaperTradingSignalStatus.PENDING
  });
  Object.assign(s, partial);
  return s;
}

describe('PaperTradingSessionSummaryService', () => {
  let service: PaperTradingSessionSummaryService;
  let summaryRepo: MockRepo<PaperTradingSessionSummary>;
  let orderRepo: MockRepo<PaperTradingOrder>;
  let signalRepo: MockRepo<PaperTradingSignal>;

  beforeEach(async () => {
    summaryRepo = { upsert: jest.fn().mockResolvedValue(undefined) };
    orderRepo = { createQueryBuilder: jest.fn() };
    signalRepo = { createQueryBuilder: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaperTradingSessionSummaryService,
        { provide: getRepositoryToken(PaperTradingSessionSummary), useValue: summaryRepo },
        { provide: getRepositoryToken(PaperTradingOrder), useValue: orderRepo },
        { provide: getRepositoryToken(PaperTradingSignal), useValue: signalRepo }
      ]
    }).compile();

    service = module.get(PaperTradingSessionSummaryService);
  });

  afterEach(() => jest.clearAllMocks());

  it('persists an empty summary with zero-initialized counters and a Date computedAt', async () => {
    (orderRepo.createQueryBuilder as jest.Mock).mockReturnValue(qbReturning([]));
    (signalRepo.createQueryBuilder as jest.Mock).mockReturnValue(qbReturning([]));

    await service.computeAndPersist('sess-1');

    const [payload, opts] = (summaryRepo.upsert as jest.Mock).mock.calls[0];
    expect(opts).toEqual({ conflictPaths: ['sessionId'], skipUpdateIfNoValuesChanged: false });
    expect(payload.sessionId).toBe('sess-1');
    expect(payload.totalOrders).toBe(0);
    expect(payload.totalFees).toBe(0);
    expect(payload.totalSignals).toBe(0);
    expect(payload.slippageCount).toBe(0);
    expect(payload.slippageSumBps).toBe(0);
    expect(payload.avgSlippageBps).toBeNull();
    expect(payload.ordersBySymbol).toEqual([]);
    expect(payload.signalsByType).toEqual({
      [PaperTradingSignalType.ENTRY]: 0,
      [PaperTradingSignalType.EXIT]: 0,
      [PaperTradingSignalType.ADJUSTMENT]: 0,
      [PaperTradingSignalType.RISK_CONTROL]: 0
    });
    expect(payload.signalsByDirection).toEqual({
      [PaperTradingSignalDirection.LONG]: 0,
      [PaperTradingSignalDirection.SHORT]: 0,
      [PaperTradingSignalDirection.FLAT]: 0
    });
    expect(payload.computedAt).toBeInstanceOf(Date);
  });

  it('aggregates orders by symbol, sums fees, falls back to UNKNOWN, and skips non-finite slippage', async () => {
    (orderRepo.createQueryBuilder as jest.Mock).mockReturnValue(
      qbReturning([
        makeOrder({
          side: PaperTradingOrderSide.BUY,
          symbol: 'BTC/USD',
          totalValue: 100,
          fee: 0.25,
          realizedPnL: 0,
          slippageBps: 10
        }),
        makeOrder({
          side: PaperTradingOrderSide.SELL,
          symbol: 'BTC/USD',
          totalValue: 120,
          fee: 0.3,
          realizedPnL: 20,
          slippageBps: 20
        }),
        makeOrder({
          side: PaperTradingOrderSide.BUY,
          symbol: 'ETH/USD',
          totalValue: 50,
          fee: 0.1,
          realizedPnL: 0,
          slippageBps: 5
        }),
        // null symbol → bucketed under 'UNKNOWN'; NaN slippage → excluded from avg
        makeOrder({
          side: PaperTradingOrderSide.BUY,
          symbol: null as unknown as string,
          totalValue: 10,
          fee: 0.05,
          realizedPnL: -2,
          slippageBps: Number.NaN
        })
      ])
    );
    (signalRepo.createQueryBuilder as jest.Mock).mockReturnValue(qbReturning([]));

    await service.computeAndPersist('sess-1');

    const [payload] = (summaryRepo.upsert as jest.Mock).mock.calls[0];
    expect(payload.totalOrders).toBe(4);
    expect(payload.buyCount).toBe(3);
    expect(payload.sellCount).toBe(1);
    expect(payload.totalVolume).toBe(280);
    expect(payload.totalFees).toBeCloseTo(0.7, 10);
    expect(payload.totalPnL).toBe(18);
    // NaN slippage on the 4th order is excluded — avg over 3 finite samples
    expect(payload.slippageCount).toBe(3);
    expect(payload.slippageSumBps).toBe(35);
    expect(Number(payload.avgSlippageBps)).toBeCloseTo(35 / 3, 10);
    // Sorted desc by totalVolume: BTC (220) → ETH (50) → UNKNOWN (10)
    expect(payload.ordersBySymbol.map((s: { symbol: string }) => s.symbol)).toEqual(['BTC/USD', 'ETH/USD', 'UNKNOWN']);
    expect(payload.ordersBySymbol[0]).toMatchObject({
      symbol: 'BTC/USD',
      orderCount: 2,
      totalVolume: 220,
      totalPnL: 20
    });
    expect(payload.ordersBySymbol[2]).toMatchObject({ symbol: 'UNKNOWN', orderCount: 1 });
  });

  it('aggregates signals by type + direction + processed, skipping non-finite confidence', async () => {
    (orderRepo.createQueryBuilder as jest.Mock).mockReturnValue(qbReturning([]));
    (signalRepo.createQueryBuilder as jest.Mock).mockReturnValue(
      qbReturning([
        makeSignal({
          signalType: PaperTradingSignalType.ENTRY,
          direction: PaperTradingSignalDirection.LONG,
          processed: true,
          confidence: 0.8
        }),
        makeSignal({
          signalType: PaperTradingSignalType.EXIT,
          direction: PaperTradingSignalDirection.FLAT,
          processed: false,
          confidence: 0.5
        }),
        // null confidence → excluded from sum/count
        makeSignal({
          signalType: PaperTradingSignalType.ADJUSTMENT,
          direction: PaperTradingSignalDirection.SHORT,
          processed: true,
          confidence: null as unknown as number
        })
      ])
    );

    await service.computeAndPersist('sess-1');

    const [payload] = (summaryRepo.upsert as jest.Mock).mock.calls[0];
    expect(payload.totalSignals).toBe(3);
    expect(payload.processedCount).toBe(2);
    expect(payload.signalsByType).toEqual({
      [PaperTradingSignalType.ENTRY]: 1,
      [PaperTradingSignalType.EXIT]: 1,
      [PaperTradingSignalType.ADJUSTMENT]: 1,
      [PaperTradingSignalType.RISK_CONTROL]: 0
    });
    expect(payload.signalsByDirection).toEqual({
      [PaperTradingSignalDirection.LONG]: 1,
      [PaperTradingSignalDirection.SHORT]: 1,
      [PaperTradingSignalDirection.FLAT]: 1
    });
    expect(payload.confidenceCount).toBe(2);
    expect(payload.confidenceSum).toBeCloseTo(1.3, 10);
  });
});
