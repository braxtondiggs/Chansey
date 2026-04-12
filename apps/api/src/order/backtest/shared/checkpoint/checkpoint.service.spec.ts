import { CheckpointService } from './checkpoint.service';

import { type BacktestTrade, TradeType } from '../../backtest-trade.entity';
import { type Portfolio } from '../portfolio';

describe('CheckpointService', () => {
  let service: CheckpointService;

  beforeEach(() => {
    service = new CheckpointService();
  });

  describe('countSells', () => {
    it('should return zeros for empty trades array', () => {
      const result = service.countSells([]);

      expect(result).toEqual({ sells: 0, winningSells: 0, grossProfit: 0, grossLoss: 0 });
    });

    it('should count sell trades and ignore buy trades', () => {
      const trades: Partial<BacktestTrade>[] = [
        { type: TradeType.BUY },
        { type: TradeType.SELL, realizedPnL: 100 },
        { type: TradeType.BUY },
        { type: TradeType.SELL, realizedPnL: -50 }
      ];

      const result = service.countSells(trades);

      expect(result.sells).toBe(2);
    });

    it('should identify winning sells by positive PnL', () => {
      const trades: Partial<BacktestTrade>[] = [
        { type: TradeType.SELL, realizedPnL: 100 },
        { type: TradeType.SELL, realizedPnL: 200 },
        { type: TradeType.SELL, realizedPnL: -50 }
      ];

      const result = service.countSells(trades);

      expect(result.winningSells).toBe(2);
      expect(result.grossProfit).toBe(300);
      expect(result.grossLoss).toBe(50);
    });

    it('should treat zero PnL sells as neither winning nor losing', () => {
      const trades: Partial<BacktestTrade>[] = [{ type: TradeType.SELL, realizedPnL: 0 }];

      const result = service.countSells(trades);

      expect(result.sells).toBe(1);
      expect(result.winningSells).toBe(0);
      expect(result.grossProfit).toBe(0);
      expect(result.grossLoss).toBe(0);
    });

    it('should handle undefined realizedPnL as zero', () => {
      const trades: Partial<BacktestTrade>[] = [{ type: TradeType.SELL }];

      const result = service.countSells(trades);

      expect(result.sells).toBe(1);
      expect(result.winningSells).toBe(0);
      expect(result.grossProfit).toBe(0);
      expect(result.grossLoss).toBe(0);
    });
  });

  describe('buildChecksumData', () => {
    it('should produce deterministic output for the same inputs', () => {
      const result1 = service.buildChecksumData(100, '2024-01-01T00:00:00Z', 5000, 3, 11000, 0.1, 42);
      const result2 = service.buildChecksumData(100, '2024-01-01T00:00:00Z', 5000, 3, 11000, 0.1, 42);

      expect(result1).toBe(result2);
    });

    it('should produce different output for different inputs', () => {
      const result1 = service.buildChecksumData(100, '2024-01-01T00:00:00Z', 5000, 3, 11000, 0.1, 42);
      const result2 = service.buildChecksumData(101, '2024-01-01T00:00:00Z', 5000, 3, 11000, 0.1, 42);

      expect(result1).not.toBe(result2);
    });

    it('should include throttle state when provided', () => {
      const withThrottle = service.buildChecksumData(100, '2024-01-01T00:00:00Z', 5000, 3, 11000, 0.1, 42, '{}');
      const withoutThrottle = service.buildChecksumData(100, '2024-01-01T00:00:00Z', 5000, 3, 11000, 0.1, 42);

      expect(withThrottle).not.toBe(withoutThrottle);
      expect(JSON.parse(withThrottle)).toHaveProperty('throttleState');
      expect(JSON.parse(withoutThrottle)).not.toHaveProperty('throttleState');
    });

    it('should produce valid JSON', () => {
      const result = service.buildChecksumData(100, '2024-01-01T00:00:00Z', 5000, 3, 11000, 0.1, 42);

      expect(() => JSON.parse(result)).not.toThrow();
      const parsed = JSON.parse(result);
      expect(parsed.lastProcessedIndex).toBe(100);
      expect(parsed.cashBalance).toBe(5000);
      expect(parsed.positionCount).toBe(3);
    });
  });

  describe('buildCheckpointState', () => {
    const createMockPortfolio = (cashBalance = 5000, positions?: Map<string, unknown>): Portfolio => {
      const pos =
        positions ??
        new Map([
          [
            'btc',
            {
              quantity: 0.5,
              averagePrice: 40000,
              entryDate: new Date('2024-01-15')
            }
          ]
        ]);
      return {
        cashBalance,
        positions: pos,
        totalValue: cashBalance + 20000
      } as unknown as Portfolio;
    };

    const defaultOpts = (overrides: Partial<Parameters<CheckpointService['buildCheckpointState']>[0]> = {}) => ({
      lastProcessedIndex: 0,
      lastProcessedTimestamp: '2024-01-01T00:00:00Z',
      portfolio: createMockPortfolio(),
      peakValue: 25000,
      maxDrawdown: 0,
      rngState: 1,
      tradesCount: 0,
      signalsCount: 0,
      fillsCount: 0,
      snapshotsCount: 0,
      sellsCount: 0,
      winningSellsCount: 0,
      ...overrides
    });

    it('should produce a valid checkpoint state with checksum', () => {
      const state = service.buildCheckpointState(
        defaultOpts({
          lastProcessedIndex: 100,
          lastProcessedTimestamp: '2024-06-01T00:00:00Z',
          peakValue: 26000,
          maxDrawdown: 0.05,
          rngState: 42,
          tradesCount: 10,
          signalsCount: 5,
          fillsCount: 8,
          snapshotsCount: 50,
          sellsCount: 4,
          winningSellsCount: 3,
          grossProfit: 500,
          grossLoss: 100
        })
      );

      expect(state.lastProcessedIndex).toBe(100);
      expect(state.lastProcessedTimestamp).toBe('2024-06-01T00:00:00Z');
      expect(state.peakValue).toBe(26000);
      expect(state.maxDrawdown).toBe(0.05);
      expect(state.rngState).toBe(42);
      expect(state.checksum).toHaveLength(16);
      expect(state.persistedCounts).toEqual({
        trades: 10,
        signals: 5,
        fills: 8,
        snapshots: 50,
        sells: 4,
        winningSells: 3,
        grossProfit: 500,
        grossLoss: 100
      });
    });

    it('should serialize portfolio positions from Map to array', () => {
      const state = service.buildCheckpointState(defaultOpts());

      expect(state.portfolio.cashBalance).toBe(5000);
      expect(state.portfolio.positions).toHaveLength(1);
      expect(state.portfolio.positions[0].coinId).toBe('btc');
      expect(state.portfolio.positions[0].quantity).toBe(0.5);
      expect(state.portfolio.positions[0].averagePrice).toBe(40000);
      expect(state.portfolio.positions[0].entryDate).toBe('2024-01-15T00:00:00.000Z');
    });

    it('should produce consistent checksums for the same input', () => {
      const opts = defaultOpts({
        lastProcessedIndex: 50,
        lastProcessedTimestamp: '2024-03-01T00:00:00Z',
        peakValue: 25000,
        maxDrawdown: 0.02,
        rngState: 99,
        tradesCount: 5,
        signalsCount: 3,
        fillsCount: 4,
        snapshotsCount: 25,
        sellsCount: 2,
        winningSellsCount: 1
      });
      const state1 = service.buildCheckpointState(opts);
      const state2 = service.buildCheckpointState(opts);

      expect(state1.checksum).toBe(state2.checksum);
    });

    it('should include throttle state when provided', () => {
      const throttleState = { lastSignalTime: { 'btc:BUY': 1000 }, tradeTimestamps: [500, 1000] };

      const state = service.buildCheckpointState(defaultOpts({ serializedThrottleState: throttleState }));

      expect(state.throttleState).toEqual(throttleState);
    });

    it('should omit throttle state when not provided', () => {
      const state = service.buildCheckpointState(defaultOpts());

      expect(state).not.toHaveProperty('throttleState');
    });

    it('should include exit tracker state when provided', () => {
      const exitTrackerState = {
        positions: {},
        configHash: 'abc'
      } as unknown as import('../exits').SerializableExitTrackerState;

      const state = service.buildCheckpointState(defaultOpts({ exitTrackerState }));

      expect(state.exitTrackerState).toBeDefined();
    });

    it('should handle empty positions map', () => {
      const portfolio = createMockPortfolio(10000, new Map());

      const state = service.buildCheckpointState(defaultOpts({ portfolio, peakValue: 10000 }));

      expect(state.portfolio.positions).toEqual([]);
      expect(state.portfolio.cashBalance).toBe(10000);
    });

    it('should omit entryDate from position when not provided', () => {
      const positions = new Map([
        [
          'eth',
          {
            quantity: 2,
            averagePrice: 3000,
            entryDate: undefined
          }
        ]
      ]);
      const portfolio = createMockPortfolio(5000, positions);

      const state = service.buildCheckpointState(defaultOpts({ portfolio, peakValue: 8000 }));

      expect(state.portfolio.positions).toHaveLength(1);
      expect(state.portfolio.positions[0].coinId).toBe('eth');
      expect(state.portfolio.positions[0]).not.toHaveProperty('entryDate');
    });

    it('should serialize multiple positions preserving order', () => {
      const positions = new Map([
        ['btc', { quantity: 0.5, averagePrice: 40000, entryDate: new Date('2024-01-15') }],
        ['eth', { quantity: 2, averagePrice: 3000, entryDate: new Date('2024-02-01') }]
      ]);
      const portfolio = createMockPortfolio(5000, positions);

      const state = service.buildCheckpointState(defaultOpts({ portfolio, peakValue: 30000 }));

      expect(state.portfolio.positions).toHaveLength(2);
      expect(state.portfolio.positions[0].coinId).toBe('btc');
      expect(state.portfolio.positions[1].coinId).toBe('eth');
    });
  });
});
