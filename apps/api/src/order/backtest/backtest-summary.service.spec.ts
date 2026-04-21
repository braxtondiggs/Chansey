import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type ObjectLiteral, type Repository, type SelectQueryBuilder } from 'typeorm';

import { BacktestSignal, SignalDirection, SignalType } from './backtest-signal.entity';
import { BacktestSummary } from './backtest-summary.entity';
import { BacktestSummaryService } from './backtest-summary.service';
import { BacktestTrade, TradeStatus, TradeType } from './backtest-trade.entity';
import { SimulatedOrderFill, SimulatedOrderStatus, SimulatedOrderType } from './simulated-order-fill.entity';

import { Coin } from '../../coin/coin.entity';

type MockRepo<T extends ObjectLiteral> = Partial<jest.Mocked<Repository<T>>>;

const qbReturningMany = (result: unknown[]) => {
  const qb: Partial<SelectQueryBuilder<ObjectLiteral>> = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(result)
  };
  return qb as SelectQueryBuilder<ObjectLiteral>;
};

describe('BacktestSummaryService', () => {
  let service: BacktestSummaryService;
  let summaryRepo: MockRepo<BacktestSummary>;
  let signalRepo: MockRepo<BacktestSignal>;
  let tradeRepo: MockRepo<BacktestTrade>;
  let fillRepo: MockRepo<SimulatedOrderFill>;
  let coinRepo: MockRepo<Coin>;

  type MockInput = {
    signals?: unknown[];
    trades?: unknown[];
    fills?: unknown[];
    coins?: unknown[];
  };

  const setupQueries = ({ signals = [], trades = [], fills = [], coins = [] }: MockInput = {}) => {
    (signalRepo.createQueryBuilder as jest.Mock).mockReturnValue(qbReturningMany(signals));
    (tradeRepo.createQueryBuilder as jest.Mock).mockReturnValue(qbReturningMany(trades));
    (fillRepo.createQueryBuilder as jest.Mock).mockReturnValue(qbReturningMany(fills));
    (coinRepo.createQueryBuilder as jest.Mock).mockReturnValue(qbReturningMany(coins));
  };

  const getUpsertPayload = () => (summaryRepo.upsert as jest.Mock).mock.calls[0][0];

  beforeEach(async () => {
    summaryRepo = { upsert: jest.fn().mockResolvedValue(undefined) };
    signalRepo = { createQueryBuilder: jest.fn() };
    tradeRepo = { createQueryBuilder: jest.fn() };
    fillRepo = { createQueryBuilder: jest.fn() };
    coinRepo = { createQueryBuilder: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BacktestSummaryService,
        { provide: getRepositoryToken(BacktestSummary), useValue: summaryRepo },
        { provide: getRepositoryToken(BacktestSignal), useValue: signalRepo },
        { provide: getRepositoryToken(BacktestTrade), useValue: tradeRepo },
        { provide: getRepositoryToken(SimulatedOrderFill), useValue: fillRepo },
        { provide: getRepositoryToken(Coin), useValue: coinRepo }
      ]
    }).compile();

    service = module.get(BacktestSummaryService);
  });

  afterEach(() => jest.clearAllMocks());

  function makeTrade(partial: Partial<BacktestTrade>): BacktestTrade {
    const t = new BacktestTrade({
      type: TradeType.SELL,
      status: TradeStatus.EXECUTED,
      quantity: 1,
      price: 100,
      totalValue: 100,
      fee: 0.1,
      executedAt: new Date('2026-04-01T00:00:00Z')
    });
    Object.assign(t, partial);
    return t;
  }

  function makeSignal(partial: Partial<BacktestSignal>): BacktestSignal {
    const s = new BacktestSignal({
      timestamp: new Date('2026-04-01T00:00:00Z'),
      signalType: SignalType.ENTRY,
      instrument: 'BTC',
      direction: SignalDirection.LONG,
      quantity: 1
    });
    Object.assign(s, partial);
    return s;
  }

  function makeFill(partial: Partial<SimulatedOrderFill>): SimulatedOrderFill {
    const f = new SimulatedOrderFill({
      orderType: SimulatedOrderType.MARKET,
      status: SimulatedOrderStatus.FILLED,
      filledQuantity: 1,
      averagePrice: 100,
      fees: 0.1,
      executionTimestamp: new Date('2026-04-01T00:00:00Z')
    });
    Object.assign(f, partial);
    return f;
  }

  it('persists an empty summary with canonical upsert options when no data exists', async () => {
    setupQueries();

    await service.computeAndPersist('bt-1');

    expect(summaryRepo.upsert).toHaveBeenCalledTimes(1);
    const [payload, opts] = (summaryRepo.upsert as jest.Mock).mock.calls[0];
    expect(opts).toEqual({ conflictPaths: ['backtestId'], skipUpdateIfNoValuesChanged: false });
    expect(payload).toMatchObject({
      backtestId: 'bt-1',
      totalSignals: 0,
      totalTrades: 0,
      buyCount: 0,
      sellCount: 0,
      winCount: 0,
      lossCount: 0,
      grossProfit: 0,
      grossLoss: 0,
      totalVolume: 0,
      totalFees: 0,
      slippageFillCount: 0,
      holdTimeCount: 0,
      largestWin: null,
      largestLoss: null,
      avgConfidence: null,
      confidenceSum: 0,
      confidenceCount: 0,
      totalRealizedPnL: null,
      holdTimeMedianMs: null,
      slippageP95Bps: null,
      holdTimeHistogram: null,
      slippageHistogram: null
    });
  });

  it('aggregates trade profitability and volume from sell trades', async () => {
    const baseCoin = { id: 'coin-btc', symbol: 'BTC' } as Coin;
    const quoteCoin = { id: 'coin-usd', symbol: 'USD' } as Coin;
    setupQueries({
      trades: [
        makeTrade({ type: TradeType.BUY, totalValue: 100, fee: 0.1, baseCoin, quoteCoin }),
        makeTrade({
          type: TradeType.SELL,
          price: 150,
          totalValue: 150,
          fee: 0.15,
          realizedPnL: 50,
          realizedPnLPercent: 0.5,
          baseCoin,
          quoteCoin,
          metadata: { holdTimeMs: 60_000 }
        }),
        makeTrade({
          type: TradeType.SELL,
          price: 80,
          totalValue: 80,
          fee: 0.08,
          realizedPnL: -20,
          realizedPnLPercent: -0.2,
          baseCoin,
          quoteCoin,
          metadata: { holdTimeMs: 120_000 }
        })
      ]
    });

    await service.computeAndPersist('bt-1');

    const payload = getUpsertPayload();
    expect(payload).toMatchObject({
      totalTrades: 3,
      buyCount: 1,
      sellCount: 2,
      winCount: 1,
      lossCount: 1,
      grossProfit: 50,
      grossLoss: 20, // Math.abs of losing pnl
      largestWin: 50,
      largestLoss: -20,
      avgWin: 50,
      avgLoss: -20,
      totalRealizedPnL: 30,
      totalVolume: 330,
      totalFees: 0.33,
      holdTimeCount: 2,
      holdTimeAvgMs: '90000', // (60k + 120k) / 2, stringified bigint
      holdTimeMinMs: '60000',
      holdTimeMaxMs: '120000',
      holdTimeMedianMs: '90000'
    });
    expect(payload.holdTimeHistogram).toEqual(
      expect.objectContaining({ count: 2, min: 60_000, max: 120_000, sum: 180_000 })
    );
    expect(payload.tradesByInstrument[0]).toEqual(
      expect.objectContaining({
        instrument: 'BTC/USD',
        tradeCount: 3,
        sellCount: 2,
        wins: 1,
        losses: 1,
        totalVolume: 330,
        totalPnL: 30
      })
    );
  });

  it('aggregates slippage with avg, p95 interpolation, and weighted total impact', async () => {
    setupQueries({
      fills: [
        makeFill({ slippageBps: 10, filledQuantity: 1, averagePrice: 100 }),
        makeFill({ slippageBps: 20, filledQuantity: 2, averagePrice: 100 }),
        makeFill({ slippageBps: 30, filledQuantity: 1, averagePrice: 100 }),
        makeFill({ slippageBps: 40, filledQuantity: 1, averagePrice: 100 }),
        makeFill({ slippageBps: 100, filledQuantity: 1, averagePrice: 100 })
      ]
    });

    await service.computeAndPersist('bt-1');

    const payload = getUpsertPayload();
    expect(payload.slippageFillCount).toBe(5);
    expect(Number(payload.slippageAvgBps)).toBeCloseTo(40, 10); // (10+20+30+40+100)/5
    expect(Number(payload.slippageMaxBps)).toBe(100);
    // p95 on sorted [10,20,30,40,100]: rank=0.95*4=3.8 → 40 + 0.8*(100-40) = 88
    expect(Number(payload.slippageP95Bps)).toBeCloseTo(88, 10);
    // sum(bps * qty * price / 10000) = (1000 + 4000 + 3000 + 4000 + 10000) / 10000 = 2.2
    expect(Number(payload.slippageTotalImpact)).toBeCloseTo(2.2, 10);
    expect(payload.slippageHistogram).toEqual(expect.objectContaining({ count: 5, min: 10, max: 100 }));
  });

  it('aggregates signals by type, direction, confidence bucket, and avgConfidence', async () => {
    setupQueries({
      signals: [
        makeSignal({ signalType: SignalType.ENTRY, direction: SignalDirection.LONG, confidence: 0.85 }),
        makeSignal({ signalType: SignalType.EXIT, direction: SignalDirection.FLAT, confidence: 0.4 }),
        makeSignal({ signalType: SignalType.ADJUSTMENT, direction: SignalDirection.SHORT, confidence: 0.6 })
      ]
    });

    await service.computeAndPersist('bt-1');

    const payload = getUpsertPayload();
    expect(payload).toMatchObject({
      totalSignals: 3,
      entryCount: 1,
      exitCount: 1,
      adjustmentCount: 1,
      riskControlCount: 0
    });
    // (0.85 + 0.4 + 0.6) / 3 ≈ 0.6166...
    expect(Number(payload.avgConfidence)).toBeCloseTo(0.6167, 3);
    expect(Number(payload.confidenceSum)).toBeCloseTo(1.85, 10);
    expect(payload.confidenceCount).toBe(3);
    expect(payload.signalsByType[SignalType.ENTRY].count).toBe(1);
    expect(payload.signalsByType[SignalType.EXIT].count).toBe(1);
    expect(payload.signalsByDirection[SignalDirection.LONG].count).toBe(1);
    expect(payload.signalsByDirection[SignalDirection.SHORT].count).toBe(1);

    // Confidence 0.85 → 80-100% bucket, 0.4 → 40-60% (exclusive upper), 0.6 → 60-80% (inclusive lower).
    const bucketCounts = Object.fromEntries(
      payload.signalsByConfidenceBucket.map((b: { bucket: string; signalCount: number }) => [b.bucket, b.signalCount])
    );
    expect(bucketCounts).toMatchObject({ '40-60%': 1, '60-80%': 1, '80-100%': 1 });
  });

  it('attaches sell-trade outcomes (wins/losses) to signal buckets via findNextSellOutcome', async () => {
    // findNextSellOutcome matches by trade.baseCoin.id.toLowerCase() === signal.instrument.toLowerCase().
    // Use a UUID to mirror the real shape (signals can store coin UUIDs directly).
    const btcId = '11111111-2222-3333-4444-555555555555';
    const baseCoin = { id: btcId, symbol: 'BTC' } as Coin;
    const quoteCoin = { id: 'coin-usd', symbol: 'USD' } as Coin;
    setupQueries({
      signals: [
        makeSignal({
          timestamp: new Date('2026-04-01T00:00:00Z'),
          signalType: SignalType.ENTRY,
          direction: SignalDirection.LONG,
          instrument: btcId,
          confidence: 0.85
        })
      ],
      trades: [
        makeTrade({
          type: TradeType.SELL,
          realizedPnL: 50,
          realizedPnLPercent: 0.5,
          baseCoin,
          quoteCoin,
          executedAt: new Date('2026-04-01T01:00:00Z')
        })
      ],
      coins: [{ id: btcId, symbol: 'BTC' }]
    });

    await service.computeAndPersist('bt-1');

    const payload = getUpsertPayload();
    expect(payload.signalsByType[SignalType.ENTRY]).toMatchObject({ count: 1, wins: 1, losses: 0 });
    expect(payload.signalsByDirection[SignalDirection.LONG]).toMatchObject({ count: 1, wins: 1, losses: 0 });
    expect(payload.signalsByInstrument[0]).toMatchObject({ instrument: 'BTC', count: 1, wins: 1, losses: 0 });
    const highBucket = payload.signalsByConfidenceBucket.find((b: { bucket: string }) => b.bucket === '80-100%');
    expect(highBucket).toMatchObject({ signalCount: 1, wins: 1, losses: 0 });
  });

  it('resolves UUID signal instruments to symbols via coinRepo lookup', async () => {
    const uuid = '11111111-2222-3333-4444-555555555555';
    setupQueries({
      signals: [makeSignal({ instrument: uuid })],
      coins: [{ id: uuid, symbol: 'BTC' }]
    });

    await service.computeAndPersist('bt-1');

    expect(coinRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
    const payload = getUpsertPayload();
    expect(payload.signalsByInstrument[0].instrument).toBe('BTC');
  });

  it('skips coin lookup when no signals use UUID instruments', async () => {
    setupQueries({ signals: [makeSignal({ instrument: 'ETH' })] });

    await service.computeAndPersist('bt-1');

    expect(coinRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(getUpsertPayload().signalsByInstrument[0].instrument).toBe('ETH');
  });

  it('skips non-finite values in trades, fills, and signals without throwing', async () => {
    const baseCoin = { id: 'coin-btc', symbol: 'BTC' } as Coin;
    const quoteCoin = { id: 'coin-usd', symbol: 'USD' } as Coin;
    setupQueries({
      signals: [makeSignal({ confidence: Number.NaN })],
      trades: [
        makeTrade({
          type: TradeType.SELL,
          realizedPnL: Number.NaN,
          realizedPnLPercent: Number.NaN,
          baseCoin,
          quoteCoin,
          metadata: { holdTimeMs: 'not-a-number' }
        })
      ],
      fills: [makeFill({ slippageBps: Number.NaN })]
    });

    await service.computeAndPersist('bt-1');

    const payload = getUpsertPayload();
    expect(payload.avgConfidence).toBeNull();
    expect(payload.winCount).toBe(0);
    expect(payload.lossCount).toBe(0);
    expect(payload.holdTimeCount).toBe(0);
    expect(payload.holdTimeHistogram).toBeNull();
    expect(payload.slippageFillCount).toBe(0);
    expect(payload.slippageHistogram).toBeNull();
  });

  it('sorts tradesByInstrument by totalVolume descending', async () => {
    const btc = { id: 'coin-btc', symbol: 'BTC' } as Coin;
    const eth = { id: 'coin-eth', symbol: 'ETH' } as Coin;
    const usd = { id: 'coin-usd', symbol: 'USD' } as Coin;
    setupQueries({
      trades: [
        makeTrade({ type: TradeType.BUY, totalValue: 100, baseCoin: btc, quoteCoin: usd }),
        makeTrade({ type: TradeType.BUY, totalValue: 500, baseCoin: eth, quoteCoin: usd }),
        makeTrade({ type: TradeType.BUY, totalValue: 250, baseCoin: eth, quoteCoin: usd })
      ]
    });

    await service.computeAndPersist('bt-1');

    const payload = getUpsertPayload();
    expect(payload.tradesByInstrument.map((t: { instrument: string }) => t.instrument)).toEqual(['ETH/USD', 'BTC/USD']);
    expect(payload.tradesByInstrument[0].totalVolume).toBe(750);
  });
});
