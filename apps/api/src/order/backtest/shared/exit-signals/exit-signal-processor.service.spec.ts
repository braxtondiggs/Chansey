import {
  ExitSignalProcessorService,
  ProcessExitSignalsCallbacks,
  ResolveExitTrackerOptions
} from './exit-signal-processor.service';

import { SimulatedOrderStatus } from '../../simulated-order-fill.entity';
import { BacktestExitTracker } from '../exits';
import { Portfolio } from '../portfolio';
import { DEFAULT_SLIPPAGE_CONFIG } from '../slippage';

describe('ExitSignalProcessorService', () => {
  let service: ExitSignalProcessorService;

  beforeEach(() => {
    service = new ExitSignalProcessorService();
  });

  describe('resolveExitTracker', () => {
    it('should return null when all exits are disabled', () => {
      const opts: ResolveExitTrackerOptions = {
        exitConfig: {
          enableStopLoss: false,
          enableTakeProfit: false,
          enableTrailingStop: false
        } as any
      };

      expect(service.resolveExitTracker(opts)).toBeNull();
    });

    it('should create tracker when exitConfig has stop-loss enabled', () => {
      const opts: ResolveExitTrackerOptions = {
        exitConfig: {
          enableStopLoss: true,
          enableTakeProfit: false,
          enableTrailingStop: false,
          stopLossValue: 5
        } as any
      };

      expect(service.resolveExitTracker(opts)).toBeInstanceOf(BacktestExitTracker);
    });

    it('should use hard stop-loss percent when no exitConfig provided', () => {
      const opts: ResolveExitTrackerOptions = {
        enableHardStopLoss: true,
        hardStopLossPercent: 0.1
      };

      expect(service.resolveExitTracker(opts)).toBeInstanceOf(BacktestExitTracker);
    });

    it('should default hardStopLossPercent to 0.05 when omitted', () => {
      const opts: ResolveExitTrackerOptions = {
        enableHardStopLoss: true
      };

      const tracker = service.resolveExitTracker(opts) as BacktestExitTracker;
      expect(tracker).toBeInstanceOf(BacktestExitTracker);

      // Verify the default 5% stop-loss triggers correctly:
      // Buy at 100, price drops to 94 (6% drop > 5% threshold) → should emit exit signal
      tracker.onBuy('test-coin', 100, 1);
      const exits = tracker.checkExits(
        new Map([['test-coin', 94]]),
        new Map([['test-coin', 94]]),
        new Map([['test-coin', 100]])
      );
      expect(exits.length).toBeGreaterThan(0);
    });

    it('should return null when enableHardStopLoss is false and no exitConfig', () => {
      const opts: ResolveExitTrackerOptions = {
        enableHardStopLoss: false
      };

      expect(service.resolveExitTracker(opts)).toBeNull();
    });

    it('should create tracker when enableHardStopLoss is omitted (defaults to enabled)', () => {
      const opts: ResolveExitTrackerOptions = {};

      expect(service.resolveExitTracker(opts)).toBeInstanceOf(BacktestExitTracker);
    });

    it('should deserialize from resumeExitTrackerState when provided', () => {
      const deserializeSpy = jest.spyOn(BacktestExitTracker, 'deserialize').mockReturnValue({} as any);
      const fakeState = { positions: {}, config: {} } as any;
      const opts: ResolveExitTrackerOptions = {
        exitConfig: {
          enableStopLoss: true,
          enableTakeProfit: false,
          enableTrailingStop: false,
          stopLossValue: 5
        } as any,
        resumeExitTrackerState: fakeState
      };

      service.resolveExitTracker(opts);

      expect(deserializeSpy).toHaveBeenCalledWith(fakeState, expect.any(Object));
      deserializeSpy.mockRestore();
    });
  });

  describe('portfolioToHoldings', () => {
    it('should compute holdings using quantity * current price', () => {
      const portfolio: Portfolio = {
        cashBalance: 10000,
        totalValue: 15000,
        positions: new Map([
          ['coin-1', { coinId: 'coin-1', quantity: 10, averagePrice: 100, totalValue: 9999 }],
          ['coin-2', { coinId: 'coin-2', quantity: 5, averagePrice: 200, totalValue: 9999 }]
        ])
      };
      const prices = new Map([
        ['coin-1', 110],
        ['coin-2', 210]
      ]);

      const result = service.portfolioToHoldings(portfolio, prices);

      // value = quantity * price (NOT position.totalValue)
      expect(result).toEqual({
        'coin-1': { quantity: 10, value: 1100, price: 110 },
        'coin-2': { quantity: 5, value: 1050, price: 210 }
      });
    });

    it('should use 0 as price when coin not in prices map', () => {
      const portfolio: Portfolio = {
        cashBalance: 10000,
        totalValue: 10000,
        positions: new Map([['coin-1', { coinId: 'coin-1', quantity: 10, averagePrice: 100, totalValue: 500 }]])
      };

      const result = service.portfolioToHoldings(portfolio, new Map());

      expect(result['coin-1']).toEqual({ quantity: 10, value: 0, price: 0 });
    });
  });

  describe('processExitSignals', () => {
    const createTestDeps = () => {
      const tracker = new BacktestExitTracker({
        enableStopLoss: true,
        stopLossValue: 5,
        enableTakeProfit: false,
        enableTrailingStop: false
      } as any);
      tracker.onBuy('coin-1', 100, 10);

      const portfolio: Portfolio = {
        cashBalance: 5000,
        totalValue: 6000,
        positions: new Map([['coin-1', { coinId: 'coin-1', quantity: 10, averagePrice: 100, totalValue: 1000 }]])
      };

      const currentPrices = [{ coinId: 'coin-1', open: 90, high: 92, low: 88, close: 90, volume: 1000 }] as any[];
      const marketData = { timestamp: new Date(), prices: new Map([['coin-1', 90]]) };

      return { tracker, portfolio, currentPrices, marketData };
    };

    it('should skip processing when exitTracker has no positions', async () => {
      const tracker = new BacktestExitTracker({
        enableStopLoss: true,
        stopLossValue: 5,
        enableTakeProfit: false,
        enableTrailingStop: false
      } as any);
      // No onBuy — tracker.size === 0

      const executeTradeFn = jest.fn();
      const callbacks: ProcessExitSignalsCallbacks = {
        executeTradeFn,
        extractDailyVolumeFn: jest.fn(),
        buildSpreadContextFn: jest.fn()
      };

      await service.processExitSignals(
        {
          exitTracker: tracker,
          currentPrices: [],
          marketData: { timestamp: new Date(), prices: new Map() },
          portfolio: { cashBalance: 0, totalValue: 0, positions: new Map() },
          tradingFee: 0,
          timestamp: new Date(),
          trades: [],
          slippageConfig: DEFAULT_SLIPPAGE_CONFIG
        },
        callbacks
      );

      expect(executeTradeFn).not.toHaveBeenCalled();
    });

    it('should NOT remove position when fill is cancelled', async () => {
      const { tracker, portfolio, currentPrices, marketData } = createTestDeps();
      const trades: any[] = [];

      const callbacks: ProcessExitSignalsCallbacks = {
        executeTradeFn: jest.fn().mockResolvedValue({
          trade: { price: 90, quantity: 10, metadata: {} },
          slippageBps: 5,
          fillStatus: SimulatedOrderStatus.CANCELLED,
          requestedQuantity: 10
        }),
        extractDailyVolumeFn: jest.fn().mockReturnValue(undefined),
        buildSpreadContextFn: jest.fn().mockReturnValue(undefined)
      };

      await service.processExitSignals(
        {
          exitTracker: tracker,
          currentPrices,
          marketData,
          portfolio,
          tradingFee: 0.001,
          timestamp: new Date(),
          trades,
          slippageConfig: DEFAULT_SLIPPAGE_CONFIG
        },
        callbacks
      );

      expect(tracker.size).toBe(1);
      expect(trades).toHaveLength(0);
    });

    it('should remove position and record trade when fill is successful', async () => {
      const { tracker, portfolio, currentPrices, marketData } = createTestDeps();
      const trades: any[] = [];

      const callbacks: ProcessExitSignalsCallbacks = {
        executeTradeFn: jest.fn().mockResolvedValue({
          trade: { price: 90, quantity: 10, fee: 0.09, metadata: {} },
          slippageBps: 5,
          fillStatus: SimulatedOrderStatus.FILLED
        }),
        extractDailyVolumeFn: jest.fn().mockReturnValue(undefined),
        buildSpreadContextFn: jest.fn().mockReturnValue(undefined)
      };

      await service.processExitSignals(
        {
          exitTracker: tracker,
          currentPrices,
          marketData,
          portfolio,
          tradingFee: 0.001,
          timestamp: new Date(),
          trades,
          slippageConfig: DEFAULT_SLIPPAGE_CONFIG
        },
        callbacks
      );

      expect(tracker.size).toBe(0);
      expect(trades).toHaveLength(1);
    });

    it('should NOT remove position when trade execution returns null', async () => {
      const { tracker, portfolio, currentPrices, marketData } = createTestDeps();
      const trades: any[] = [];

      const callbacks: ProcessExitSignalsCallbacks = {
        executeTradeFn: jest.fn().mockResolvedValue(null),
        extractDailyVolumeFn: jest.fn().mockReturnValue(undefined),
        buildSpreadContextFn: jest.fn().mockReturnValue(undefined)
      };

      await service.processExitSignals(
        {
          exitTracker: tracker,
          currentPrices,
          marketData,
          portfolio,
          tradingFee: 0.001,
          timestamp: new Date(),
          trades,
          slippageConfig: DEFAULT_SLIPPAGE_CONFIG
        },
        callbacks
      );

      expect(tracker.size).toBe(1);
      expect(trades).toHaveLength(0);
    });

    it('should record signal and simulatedFill in full-fidelity mode', async () => {
      const { tracker, portfolio, currentPrices, marketData } = createTestDeps();
      const trades: any[] = [];
      const signals: any[] = [];
      const simulatedFills: any[] = [];
      const backtest = { id: 'bt-1' } as any;

      const callbacks: ProcessExitSignalsCallbacks = {
        executeTradeFn: jest.fn().mockResolvedValue({
          trade: { price: 90, quantity: 10, fee: 0.09, metadata: {} },
          slippageBps: 5,
          fillStatus: SimulatedOrderStatus.FILLED
        }),
        extractDailyVolumeFn: jest.fn().mockReturnValue(5000),
        buildSpreadContextFn: jest.fn().mockReturnValue(undefined)
      };

      await service.processExitSignals(
        {
          exitTracker: tracker,
          currentPrices,
          marketData,
          portfolio,
          tradingFee: 0.001,
          timestamp: new Date(),
          trades,
          signals,
          simulatedFills,
          backtest,
          slippageConfig: DEFAULT_SLIPPAGE_CONFIG
        },
        callbacks
      );

      expect(signals).toHaveLength(1);
      expect(signals[0]).toMatchObject({
        signalType: 'RISK_CONTROL',
        direction: 'SHORT',
        instrument: 'coin-1',
        backtest
      });
      expect(simulatedFills).toHaveLength(1);
      expect(simulatedFills[0]).toMatchObject({
        status: SimulatedOrderStatus.FILLED,
        filledQuantity: 10,
        instrument: 'coin-1',
        backtest
      });
      expect(tracker.size).toBe(0);
      expect(trades).toHaveLength(1);
      expect(trades[0].backtest).toBe(backtest);
    });

    it('should record cancelled simulatedFill in full-fidelity mode without removing position', async () => {
      const { tracker, portfolio, currentPrices, marketData } = createTestDeps();
      const trades: any[] = [];
      const signals: any[] = [];
      const simulatedFills: any[] = [];
      const backtest = { id: 'bt-1' } as any;

      const callbacks: ProcessExitSignalsCallbacks = {
        executeTradeFn: jest.fn().mockResolvedValue({
          trade: { price: 90, quantity: 10, metadata: {} },
          slippageBps: 5,
          fillStatus: SimulatedOrderStatus.CANCELLED,
          requestedQuantity: 10
        }),
        extractDailyVolumeFn: jest.fn().mockReturnValue(undefined),
        buildSpreadContextFn: jest.fn().mockReturnValue(undefined)
      };

      await service.processExitSignals(
        {
          exitTracker: tracker,
          currentPrices,
          marketData,
          portfolio,
          tradingFee: 0.001,
          timestamp: new Date(),
          trades,
          signals,
          simulatedFills,
          backtest,
          slippageConfig: DEFAULT_SLIPPAGE_CONFIG
        },
        callbacks
      );

      expect(tracker.size).toBe(1);
      expect(trades).toHaveLength(0);
      expect(simulatedFills).toHaveLength(1);
      expect(simulatedFills[0]).toMatchObject({
        status: SimulatedOrderStatus.CANCELLED,
        filledQuantity: 0,
        instrument: 'coin-1'
      });
    });
  });
});
