import { PaperTradingOrderExecutorService, type ExecuteOrderContext } from './paper-trading-order-executor.service';

import { SignalType as AlgoSignalType } from '../../../algorithm/interfaces';
import { PaperTradingOrderSide } from '../entities';

type TxAccount = {
  currency: string;
  available: number;
  averageCost?: number;
  entryDate?: Date;
  locked?: number;
};

interface HarnessOptions {
  quote: TxAccount;
  base?: TxAccount | null;
  slippage?: { estimatedPrice?: number; slippageBps?: number; marketImpact?: number };
  fee?: number;
}

const createHarness = (options: HarnessOptions) => {
  const saved: any[] = [];

  const txManager = {
    findOne: jest.fn((_entity: any, query: any) => {
      const currency = query?.where?.currency;
      if (currency === options.quote.currency) return Promise.resolve(options.quote);
      if (options.base && currency === options.base.currency) return Promise.resolve(options.base);
      return Promise.resolve(null);
    }),
    create: jest.fn((_entity: any, data: any) => ({ ...data })),
    save: jest.fn((entity: any) => {
      saved.push(entity);
      return Promise.resolve(entity);
    })
  };

  const dataSource = {
    transaction: jest.fn((cb: any) => cb(txManager))
  };

  const feeCalculator = {
    fromFlatRate: jest.fn().mockReturnValue({ rate: 0.001 }),
    calculateFee: jest.fn().mockReturnValue({ fee: options.fee ?? 10 })
  };

  const marketDataService = {
    calculateRealisticSlippage: jest.fn().mockResolvedValue({
      estimatedPrice: options.slippage?.estimatedPrice ?? 100,
      slippageBps: options.slippage?.slippageBps ?? 0,
      marketImpact: options.slippage?.marketImpact ?? 0
    })
  };

  const executor = new PaperTradingOrderExecutorService(
    dataSource as any,
    feeCalculator as any,
    marketDataService as any
  );

  return { executor, saved, txManager, feeCalculator, marketDataService };
};

const baseCtx = (overrides: Partial<ExecuteOrderContext> = {}): ExecuteOrderContext =>
  ({
    session: { id: 'sess-1', tradingFee: 0.001, algorithmConfig: {} },
    signal: { action: 'BUY', symbol: 'BTC/USD', reason: 'test' },
    signalEntity: { id: 'sig-1' },
    portfolio: { totalValue: 10_000, cashBalance: 10_000, positions: new Map() },
    prices: { 'BTC/USD': 100 },
    exchangeSlug: 'binance',
    quoteCurrency: 'USD',
    timestamp: new Date('2024-01-01T00:00:00Z'),
    allocation: { maxAllocation: 0.5, minAllocation: 0.01 },
    ...overrides
  }) as ExecuteOrderContext;

const findOrder = (saved: any[], side: PaperTradingOrderSide) => saved.find((s) => s.side === side);

describe('PaperTradingOrderExecutorService', () => {
  describe('guard clauses', () => {
    it('returns no_price when the symbol has no price', async () => {
      const { executor } = createHarness({ quote: { currency: 'USD', available: 10_000 } });
      const result = await executor.execute(baseCtx({ prices: {} }));
      expect(result).toEqual({ status: 'no_price', order: null });
    });

    it('throws when the quote account is missing', async () => {
      const { executor, txManager } = createHarness({ quote: { currency: 'USD', available: 10_000 } });
      // Override: quote lookup returns null.
      (txManager.findOne as jest.Mock).mockResolvedValue(null);
      await expect(executor.execute(baseCtx())).rejects.toThrow(/Quote currency account/);
    });
  });

  describe('BUY sizing', () => {
    it('executes with explicit quantity and persists a FILLED order', async () => {
      const { executor, saved } = createHarness({ quote: { currency: 'USD', available: 10_000 } });
      const result = await executor.execute(
        baseCtx({ signal: { action: 'BUY', coinId: 'btc', symbol: 'BTC/USD', quantity: 2, reason: 'entry' } as any })
      );
      expect(result.status).toBe('success');
      const order = findOrder(saved, PaperTradingOrderSide.BUY);
      expect(order.filledQuantity).toBe(2);
      expect(order.totalValue).toBe(200);
      expect(order.fee).toBe(10);
    });

    it('caps explicit BUY quantity to maxAllocation', async () => {
      const { executor, saved } = createHarness({ quote: { currency: 'USD', available: 1_000_000 } });
      // totalValue=10_000, maxAllocation=0.5 → max=50 units @ 100.
      const result = await executor.execute(
        baseCtx({ signal: { action: 'BUY', coinId: 'btc', symbol: 'BTC/USD', quantity: 999, reason: 'x' } as any })
      );
      expect(result.status).toBe('success');
      expect(findOrder(saved, PaperTradingOrderSide.BUY).filledQuantity).toBe(50);
    });

    it('percentage → Math.min(percentage, maxAllocation) * totalValue / price', async () => {
      const { executor, saved } = createHarness({ quote: { currency: 'USD', available: 10_000 } });
      await executor.execute(
        baseCtx({ signal: { action: 'BUY', coinId: 'btc', symbol: 'BTC/USD', percentage: 0.2, reason: 'x' } as any })
      );
      // 0.2 * 10_000 / 100 = 20
      expect(findOrder(saved, PaperTradingOrderSide.BUY).filledQuantity).toBeCloseTo(20, 6);
    });

    it('confidence → interpolates between min and max allocation', async () => {
      const { executor, saved } = createHarness({ quote: { currency: 'USD', available: 10_000 } });
      await executor.execute(
        baseCtx({ signal: { action: 'BUY', coinId: 'btc', symbol: 'BTC/USD', confidence: 0.5, reason: 'x' } as any })
      );
      // alloc = 0.01 + 0.5*(0.5-0.01) = 0.255 → 25.5 units
      expect(findOrder(saved, PaperTradingOrderSide.BUY).filledQuantity).toBeCloseTo(25.5, 6);
    });

    it('no sizing hint → falls back to minAllocation', async () => {
      const { executor, saved } = createHarness({ quote: { currency: 'USD', available: 10_000 } });
      await executor.execute(
        baseCtx({ signal: { action: 'BUY', coinId: 'btc', symbol: 'BTC/USD', reason: 'x' } as any })
      );
      // 0.01 * 10_000 / 100 = 1
      expect(findOrder(saved, PaperTradingOrderSide.BUY).filledQuantity).toBeCloseTo(1, 6);
    });

    it('returns insufficient_funds when balance < total cost', async () => {
      const { executor } = createHarness({ quote: { currency: 'USD', available: 50 } });
      const result = await executor.execute(
        baseCtx({ signal: { action: 'BUY', coinId: 'btc', symbol: 'BTC/USD', quantity: 2, reason: 'x' } as any })
      );
      expect(result.status).toBe('insufficient_funds');
    });

    it('computes weighted-average cost when adding to an existing position', async () => {
      const base: TxAccount = {
        currency: 'BTC',
        available: 10,
        averageCost: 80,
        entryDate: new Date('2023-01-01')
      };
      const { executor, saved } = createHarness({ quote: { currency: 'USD', available: 10_000 }, base });
      await executor.execute(
        baseCtx({ signal: { action: 'BUY', coinId: 'btc', symbol: 'BTC/USD', quantity: 10, reason: 'add' } as any })
      );
      // (80*10 + 100*10) / 20 = 90
      expect(base.averageCost).toBeCloseTo(90, 6);
      expect(base.available).toBe(20);
      // entryDate is preserved (not reset) when adding to a non-empty position
      expect(base.entryDate).toEqual(new Date('2023-01-01'));
      expect(findOrder(saved, PaperTradingOrderSide.BUY)).toBeDefined();
    });
  });

  describe('SELL sizing (BUG #3)', () => {
    const runSell = async (signalExtras: any, extras: { base?: TxAccount } = {}) => {
      const base: TxAccount = extras.base ?? {
        currency: 'BTC',
        available: 10,
        averageCost: 50,
        entryDate: new Date('2020-01-01')
      };
      const { executor, saved } = createHarness({ quote: { currency: 'USD', available: 5_000 }, base });
      const result = await executor.execute(
        baseCtx({
          signal: { action: 'SELL', coinId: 'btc', symbol: 'BTC/USD', reason: 'exit', ...signalExtras } as any
        })
      );
      return { result, order: findOrder(saved, PaperTradingOrderSide.SELL), base };
    };

    it.each([
      ['explicit quantity capped to held', { quantity: 7 }, 7],
      ['explicit quantity exceeding held is capped', { quantity: 999 }, 10],
      ['percentage → percentage * heldQty', { percentage: 0.4 }, 4],
      ['confidence → confidence * heldQty (no legacy 0.25+0.75 blend)', { confidence: 0.8 }, 8],
      ['no sizing hint → 100% of heldQty (no legacy 25% fallback)', {}, 10]
    ])('%s', async (_name, extras, expected) => {
      const { result, order } = await runSell(extras);
      expect(result.status).toBe('success');
      expect(order.filledQuantity).toBeCloseTo(expected, 6);
    });

    it('full sell zeroes balance and resets averageCost/entryDate', async () => {
      const { base } = await runSell({ quantity: 10 });
      expect(base.available).toBe(0);
      expect(base.averageCost).toBeUndefined();
      expect(base.entryDate).toBeUndefined();
    });
  });

  describe('SELL guards', () => {
    it('returns no_position when no base account exists', async () => {
      const { executor } = createHarness({ quote: { currency: 'USD', available: 5_000 }, base: null });
      const result = await executor.execute(
        baseCtx({ signal: { action: 'SELL', coinId: 'btc', symbol: 'BTC/USD', reason: 'exit' } as any })
      );
      expect(result).toEqual({ status: 'no_position', order: null });
    });

    it('returns no_position when base account has zero balance', async () => {
      const { executor } = createHarness({
        quote: { currency: 'USD', available: 5_000 },
        base: { currency: 'BTC', available: 0 }
      });
      const result = await executor.execute(
        baseCtx({ signal: { action: 'SELL', coinId: 'btc', symbol: 'BTC/USD', reason: 'exit' } as any })
      );
      expect(result.status).toBe('no_position');
    });

    it('returns hold_period when min hold not met for a non-risk-control exit', async () => {
      const entryDate = new Date('2023-12-31T23:00:00Z'); // 1h before ctx timestamp
      const { executor } = createHarness({
        quote: { currency: 'USD', available: 5_000 },
        base: { currency: 'BTC', available: 10, averageCost: 50, entryDate }
      });
      const result = await executor.execute(
        baseCtx({
          // minHoldMs = 24h; only 1h has passed
          session: { id: 'sess-1', tradingFee: 0.001, algorithmConfig: { minHoldMs: 24 * 3600 * 1000 } } as any,
          signal: { action: 'SELL', coinId: 'btc', symbol: 'BTC/USD', reason: 'exit' } as any
        })
      );
      expect(result.status).toBe('hold_period');
    });

    it('bypasses hold period for STOP_LOSS / TAKE_PROFIT', async () => {
      const entryDate = new Date('2023-12-31T23:00:00Z');
      const { executor, saved } = createHarness({
        quote: { currency: 'USD', available: 5_000 },
        base: { currency: 'BTC', available: 10, averageCost: 50, entryDate }
      });
      const result = await executor.execute(
        baseCtx({
          session: { id: 'sess-1', tradingFee: 0.001, algorithmConfig: { minHoldMs: 24 * 3600 * 1000 } } as any,
          signal: {
            action: 'SELL',
            coinId: 'btc',
            symbol: 'BTC/USD',
            reason: 'sl',
            originalType: AlgoSignalType.STOP_LOSS
          } as any
        })
      );
      expect(result.status).toBe('success');
      expect(findOrder(saved, PaperTradingOrderSide.SELL)).toBeDefined();
    });
  });

  describe('SELL realized PnL (BUG #4)', () => {
    it('includes fee in realizedPnLPercent numerator', async () => {
      const { executor, saved } = createHarness({
        quote: { currency: 'USD', available: 0 },
        base: { currency: 'BTC', available: 10, averageCost: 100, entryDate: new Date('2020-01-01') },
        slippage: { estimatedPrice: 110 },
        fee: 50
      });
      const result = await executor.execute(
        baseCtx({
          signal: { action: 'SELL', coinId: 'btc', symbol: 'BTC/USD', quantity: 10, reason: 'exit' } as any,
          prices: { 'BTC/USD': 110 }
        })
      );
      expect(result.status).toBe('success');
      const order = findOrder(saved, PaperTradingOrderSide.SELL);
      // proceeds=1100, fee=50, costBasisTotal=1000 → (1100-50-1000)/1000 = 0.05
      expect(order.realizedPnLPercent).toBeCloseTo(0.05, 6);
      // realizedPnL = (110-100)*10 - 50 = 50
      expect(order.realizedPnL).toBeCloseTo(50, 6);
    });

    it('realizedPnLPercent is 0 when costBasis is 0', async () => {
      const { executor, saved } = createHarness({
        quote: { currency: 'USD', available: 0 },
        base: { currency: 'BTC', available: 10, averageCost: 0, entryDate: new Date('2020-01-01') }
      });
      await executor.execute(
        baseCtx({
          signal: { action: 'SELL', coinId: 'btc', symbol: 'BTC/USD', quantity: 10, reason: 'exit' } as any
        })
      );
      expect(findOrder(saved, PaperTradingOrderSide.SELL).realizedPnLPercent).toBe(0);
    });
  });
});
