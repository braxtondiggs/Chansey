import { DEFAULT_THROTTLE_CONFIG, SignalThrottleConfig } from './signal-throttle.interface';
import { SignalThrottleService } from './signal-throttle.service';

import { SignalType as AlgoSignalType } from '../../../../algorithm/interfaces';
import { TradingSignal } from '../../backtest-engine.service';

describe('SignalThrottleService', () => {
  let service: SignalThrottleService;

  const BASE_TIME = new Date('2024-06-01T00:00:00Z').getTime();
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_DAY = 24 * ONE_HOUR;

  const makeBuy = (coinId = 'btc', confidence = 0.8): TradingSignal => ({
    action: 'BUY',
    coinId,
    reason: 'test buy',
    confidence,
    originalType: AlgoSignalType.BUY
  });

  const makeSell = (coinId = 'btc', confidence = 0.3, percentage?: number): TradingSignal => ({
    action: 'SELL',
    coinId,
    reason: 'test sell',
    confidence,
    ...(percentage !== undefined && { percentage }),
    originalType: AlgoSignalType.SELL
  });

  const makeStopLoss = (coinId = 'btc'): TradingSignal => ({
    action: 'SELL',
    coinId,
    reason: 'stop loss triggered',
    confidence: 1.0,
    originalType: AlgoSignalType.STOP_LOSS
  });

  const makeTakeProfit = (coinId = 'btc'): TradingSignal => ({
    action: 'SELL',
    coinId,
    reason: 'take profit triggered',
    confidence: 1.0,
    originalType: AlgoSignalType.TAKE_PROFIT
  });

  beforeEach(() => {
    service = new SignalThrottleService();
  });

  it('should create fresh state with empty fields', () => {
    const state = service.createState();
    expect(state.lastSignalTime).toEqual({});
    expect(state.tradeTimestamps).toEqual([]);
  });

  describe('filterSignals', () => {
    const config: SignalThrottleConfig = { ...DEFAULT_THROTTLE_CONFIG };

    it('fresh state — all signals pass', () => {
      const state = service.createState();
      const signals = [makeBuy('btc'), makeSell('eth', 0.8, 0.6)];
      const result = service.filterSignals(signals, state, config, BASE_TIME);
      expect(result).toHaveLength(2);
    });

    it('should filter out HOLD signals', () => {
      const state = service.createState();
      const holdSignal: TradingSignal = {
        action: 'HOLD',
        coinId: 'btc',
        reason: 'hold',
        confidence: 0.5
      };
      const result = service.filterSignals([holdSignal], state, config, BASE_TIME);
      expect(result).toHaveLength(0);
    });

    describe('cooldown', () => {
      it('same coin+direction within cooldownMs is suppressed', () => {
        const state = service.createState();
        service.filterSignals([makeBuy('btc')], state, config, BASE_TIME);

        const result = service.filterSignals([makeBuy('btc')], state, config, BASE_TIME + ONE_HOUR);
        expect(result).toHaveLength(0);
      });

      it('BUY cooldown does not block SELL for same coin', () => {
        const state = service.createState();
        service.filterSignals([makeBuy('btc')], state, config, BASE_TIME);

        const result = service.filterSignals([makeSell('btc', 0.8, 0.6)], state, config, BASE_TIME + ONE_HOUR);
        expect(result).toHaveLength(1);
        expect(result[0].action).toBe('SELL');
      });

      it('BUY cooldown for BTC does not block BUY for ETH', () => {
        const state = service.createState();
        service.filterSignals([makeBuy('btc')], state, config, BASE_TIME);

        const result = service.filterSignals([makeBuy('eth')], state, config, BASE_TIME + ONE_HOUR);
        expect(result).toHaveLength(1);
        expect(result[0].coinId).toBe('eth');
      });

      it('signal passes after cooldownMs elapsed', () => {
        const state = service.createState();
        service.filterSignals([makeBuy('btc')], state, config, BASE_TIME);

        const result = service.filterSignals([makeBuy('btc')], state, config, BASE_TIME + ONE_DAY);
        expect(result).toHaveLength(1);
      });

      it('cooldownMs: 0 disables cooldown', () => {
        const state = service.createState();
        const noCooldown: SignalThrottleConfig = { ...config, cooldownMs: 0, maxTradesPerDay: 100 };

        service.filterSignals([makeBuy('btc')], state, noCooldown, BASE_TIME);
        const result = service.filterSignals([makeBuy('btc')], state, noCooldown, BASE_TIME + 1);
        expect(result).toHaveLength(1);
      });

      it('second same-coin BUY in a single batch is suppressed by mid-batch cooldown', () => {
        const state = service.createState();
        const signals = [makeBuy('btc'), makeBuy('btc')];
        const result = service.filterSignals(signals, state, config, BASE_TIME);
        expect(result).toHaveLength(1);
      });
    });

    describe('daily trade limit', () => {
      it('signals suppressed after maxTradesPerDay reached', () => {
        const state = service.createState();
        const limitConfig: SignalThrottleConfig = { ...config, maxTradesPerDay: 2, cooldownMs: 0 };

        service.filterSignals([makeBuy('btc')], state, limitConfig, BASE_TIME);
        service.filterSignals([makeBuy('eth')], state, limitConfig, BASE_TIME + 1000);

        const result = service.filterSignals([makeBuy('sol')], state, limitConfig, BASE_TIME + 2000);
        expect(result).toHaveLength(0);
      });

      it('24h rolling window prunes old entries', () => {
        const state = service.createState();
        const limitConfig: SignalThrottleConfig = { ...config, maxTradesPerDay: 2, cooldownMs: 0 };

        service.filterSignals([makeBuy('btc')], state, limitConfig, BASE_TIME);
        service.filterSignals([makeBuy('eth')], state, limitConfig, BASE_TIME + 1000);

        const result = service.filterSignals([makeBuy('sol')], state, limitConfig, BASE_TIME + ONE_DAY + 1);
        expect(result).toHaveLength(1);
      });

      it('maxTradesPerDay: 0 disables daily cap', () => {
        const state = service.createState();
        const noCap: SignalThrottleConfig = { ...config, maxTradesPerDay: 0, cooldownMs: 0 };

        for (let i = 0; i < 20; i++) {
          const result = service.filterSignals([makeBuy(`coin-${i}`)], state, noCap, BASE_TIME + i);
          expect(result).toHaveLength(1);
        }
      });
    });

    describe('bypass signals (STOP_LOSS / TAKE_PROFIT)', () => {
      const strictConfig: SignalThrottleConfig = { cooldownMs: ONE_DAY, maxTradesPerDay: 1, minSellPercent: 0.5 };

      it.each([
        ['STOP_LOSS', AlgoSignalType.STOP_LOSS, () => makeStopLoss('btc')],
        ['TAKE_PROFIT', AlgoSignalType.TAKE_PROFIT, () => makeTakeProfit('btc')]
      ] as const)('%s bypasses cooldown and daily limit', (_label, expectedType, makeSignal) => {
        const state = service.createState();
        service.filterSignals([makeBuy('btc')], state, strictConfig, BASE_TIME);

        const result = service.filterSignals([makeSignal()], state, strictConfig, BASE_TIME + ONE_HOUR);
        expect(result).toHaveLength(1);
        expect(result[0].originalType).toBe(expectedType);
      });

      it('bypass signals do not count against daily limit', () => {
        const state = service.createState();
        const capConfig: SignalThrottleConfig = { cooldownMs: 0, maxTradesPerDay: 2, minSellPercent: 0.5 };

        service.filterSignals([makeStopLoss('btc')], state, capConfig, BASE_TIME);
        service.filterSignals([makeTakeProfit('eth')], state, capConfig, BASE_TIME + 1000);

        const result = service.filterSignals([makeBuy('sol')], state, capConfig, BASE_TIME + 2000);
        expect(result).toHaveLength(1);
      });

      it('bypass signals do not set cooldown', () => {
        const state = service.createState();
        service.filterSignals([makeStopLoss('btc')], state, config, BASE_TIME);

        const result = service.filterSignals([makeSell('btc', 0.8, 0.6)], state, config, BASE_TIME + ONE_HOUR);
        expect(result).toHaveLength(1);
      });
    });

    describe('min sell percentage', () => {
      it('SELL below floor gets percentage raised to minSellPercent', () => {
        const state = service.createState();
        const signal = makeSell('btc', 0.3, 0.3);
        const result = service.filterSignals([signal], state, config, BASE_TIME);
        expect(result).toHaveLength(1);
        expect(result[0].percentage).toBe(0.5);
      });

      it('SELL with undefined percentage gets floored to minSellPercent', () => {
        const state = service.createState();
        const signal = makeSell('btc', 0.3); // no percentage arg → undefined
        const result = service.filterSignals([signal], state, config, BASE_TIME);
        expect(result).toHaveLength(1);
        expect(result[0].percentage).toBe(0.5);
      });

      it('explicit quantity SELL is NOT modified', () => {
        const state = service.createState();
        const signal: TradingSignal = {
          action: 'SELL',
          coinId: 'btc',
          reason: 'test',
          confidence: 0.2,
          quantity: 0.5,
          percentage: 0.1,
          originalType: AlgoSignalType.SELL
        };
        const result = service.filterSignals([signal], state, config, BASE_TIME);
        expect(result).toHaveLength(1);
        expect(result[0].percentage).toBe(0.1);
      });

      it('high-confidence SELL above floor is NOT modified', () => {
        const state = service.createState();
        const signal = makeSell('btc', 0.9, 0.8);
        const result = service.filterSignals([signal], state, config, BASE_TIME);
        expect(result).toHaveLength(1);
        expect(result[0].percentage).toBe(0.8);
      });

      it('minSellPercent: 0 disables sell floor', () => {
        const state = service.createState();
        const noFloor: SignalThrottleConfig = { ...config, minSellPercent: 0 };
        const signal = makeSell('btc', 0.3, 0.1);
        const result = service.filterSignals([signal], state, noFloor, BASE_TIME);
        expect(result).toHaveLength(1);
        expect(result[0].percentage).toBe(0.1);
      });
    });

    it('should update state.lastSignalTime and state.tradeTimestamps on accepted signals', () => {
      const state = service.createState();
      service.filterSignals([makeBuy('btc')], state, config, BASE_TIME);

      expect(state.lastSignalTime['btc:BUY']).toBe(BASE_TIME);
      expect(state.tradeTimestamps).toEqual([BASE_TIME]);
    });
  });

  describe('serialize / deserialize', () => {
    it('roundtrip preserves state', () => {
      const state = service.createState();
      service.filterSignals([makeBuy('btc'), makeSell('eth', 0.8, 0.6)], state, DEFAULT_THROTTLE_CONFIG, BASE_TIME);

      const serialized = service.serialize(state);
      const restored = service.deserialize(serialized);

      expect(restored.lastSignalTime).toEqual(state.lastSignalTime);
      expect(restored.tradeTimestamps).toEqual(state.tradeTimestamps);

      // Ensure it's a deep copy — mutations don't leak
      restored.tradeTimestamps.push(999);
      expect(state.tradeTimestamps).not.toContain(999);
    });
  });
});
