import {
  DEFAULT_THROTTLE_CONFIG,
  PAPER_TRADING_DEFAULT_THROTTLE_CONFIG,
  type SignalThrottleConfig
} from './signal-throttle.interface';
import { SignalThrottleService } from './signal-throttle.service';

import { SignalType as AlgoSignalType } from '../../../../algorithm/interfaces';
import { type TradingSignal } from '../types';

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

  describe('filterSignals', () => {
    const config: SignalThrottleConfig = { ...DEFAULT_THROTTLE_CONFIG };

    it('fresh state — all signals pass', () => {
      const state = service.createState();
      const signals = [makeBuy('btc'), makeSell('eth', 0.8, 0.6)];
      const { accepted } = service.filterSignals(signals, state, config, BASE_TIME);
      expect(accepted).toHaveLength(2);
    });

    it('should filter out HOLD signals', () => {
      const state = service.createState();
      const holdSignal: TradingSignal = {
        action: 'HOLD',
        coinId: 'btc',
        reason: 'hold',
        confidence: 0.5
      };
      const { accepted, rejected } = service.filterSignals([holdSignal], state, config, BASE_TIME);
      expect(accepted).toHaveLength(0);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toBe(holdSignal);
    });

    describe('cooldown', () => {
      it('same coin+direction within cooldownMs is suppressed', () => {
        const state = service.createState();
        service.filterSignals([makeBuy('btc')], state, config, BASE_TIME);

        const { accepted } = service.filterSignals([makeBuy('btc')], state, config, BASE_TIME + ONE_HOUR);
        expect(accepted).toHaveLength(0);
      });

      it('BUY cooldown does not block SELL for same coin', () => {
        const state = service.createState();
        service.filterSignals([makeBuy('btc')], state, config, BASE_TIME);

        const { accepted } = service.filterSignals([makeSell('btc', 0.8, 0.6)], state, config, BASE_TIME + ONE_HOUR);
        expect(accepted).toHaveLength(1);
        expect(accepted[0].action).toBe('SELL');
      });

      it('BUY cooldown for BTC does not block BUY for ETH', () => {
        const state = service.createState();
        service.filterSignals([makeBuy('btc')], state, config, BASE_TIME);

        const { accepted } = service.filterSignals([makeBuy('eth')], state, config, BASE_TIME + ONE_HOUR);
        expect(accepted).toHaveLength(1);
        expect(accepted[0].coinId).toBe('eth');
      });

      it('signal passes after cooldownMs elapsed', () => {
        const state = service.createState();
        service.filterSignals([makeBuy('btc')], state, config, BASE_TIME);

        const { accepted } = service.filterSignals([makeBuy('btc')], state, config, BASE_TIME + ONE_DAY);
        expect(accepted).toHaveLength(1);
      });

      it('cooldownMs: 0 disables cooldown', () => {
        const state = service.createState();
        const noCooldown: SignalThrottleConfig = { ...config, cooldownMs: 0, maxTradesPerDay: 100 };

        service.filterSignals([makeBuy('btc')], state, noCooldown, BASE_TIME);
        const { accepted } = service.filterSignals([makeBuy('btc')], state, noCooldown, BASE_TIME + 1);
        expect(accepted).toHaveLength(1);
      });

      it('second same-coin BUY in a single batch is suppressed by mid-batch cooldown', () => {
        const state = service.createState();
        const signals = [makeBuy('btc'), makeBuy('btc')];
        const { accepted } = service.filterSignals(signals, state, config, BASE_TIME);
        expect(accepted).toHaveLength(1);
      });

      it('cooldown-rejected signal appears in rejected array', () => {
        const state = service.createState();
        service.filterSignals([makeBuy('btc')], state, config, BASE_TIME);

        const signal = makeBuy('btc');
        const { accepted, rejected } = service.filterSignals([signal], state, config, BASE_TIME + ONE_HOUR);
        expect(accepted).toHaveLength(0);
        expect(rejected).toHaveLength(1);
        expect(rejected[0]).toBe(signal);
      });
    });

    describe('daily trade limit', () => {
      it('signals suppressed after maxTradesPerDay reached', () => {
        const state = service.createState();
        const limitConfig: SignalThrottleConfig = { ...config, maxTradesPerDay: 2, cooldownMs: 0 };

        service.filterSignals([makeBuy('btc')], state, limitConfig, BASE_TIME);
        service.filterSignals([makeBuy('eth')], state, limitConfig, BASE_TIME + 1000);

        const { accepted } = service.filterSignals([makeBuy('sol')], state, limitConfig, BASE_TIME + 2000);
        expect(accepted).toHaveLength(0);
      });

      it('24h rolling window prunes old entries', () => {
        const state = service.createState();
        const limitConfig: SignalThrottleConfig = { ...config, maxTradesPerDay: 2, cooldownMs: 0 };

        service.filterSignals([makeBuy('btc')], state, limitConfig, BASE_TIME);
        service.filterSignals([makeBuy('eth')], state, limitConfig, BASE_TIME + 1000);

        const { accepted } = service.filterSignals([makeBuy('sol')], state, limitConfig, BASE_TIME + ONE_DAY + 1);
        expect(accepted).toHaveLength(1);
      });

      it('maxTradesPerDay: 0 disables daily cap', () => {
        const state = service.createState();
        const noCap: SignalThrottleConfig = { ...config, maxTradesPerDay: 0, cooldownMs: 0 };

        for (let i = 0; i < 20; i++) {
          const { accepted } = service.filterSignals([makeBuy(`coin-${i}`)], state, noCap, BASE_TIME + i);
          expect(accepted).toHaveLength(1);
        }
      });
    });

    describe('bypass signals (STOP_LOSS / TAKE_PROFIT / SHORT_EXIT)', () => {
      const makeShortExit = (coinId = 'btc'): TradingSignal => ({
        action: 'CLOSE_SHORT',
        coinId,
        reason: 'short exit triggered',
        confidence: 1.0,
        originalType: AlgoSignalType.SHORT_EXIT
      });

      const strictConfig: SignalThrottleConfig = { cooldownMs: ONE_DAY, maxTradesPerDay: 1, minSellPercent: 0.5 };

      it.each([
        ['STOP_LOSS', AlgoSignalType.STOP_LOSS, () => makeStopLoss('btc')],
        ['TAKE_PROFIT', AlgoSignalType.TAKE_PROFIT, () => makeTakeProfit('btc')],
        ['SHORT_EXIT', AlgoSignalType.SHORT_EXIT, () => makeShortExit('btc')]
      ] as const)('%s bypasses daily limit', (_label, expectedType, makeSignal) => {
        const state = service.createState();
        // Fill daily cap with a normal trade
        const noCooldownStrict: SignalThrottleConfig = { ...strictConfig, cooldownMs: 0 };
        service.filterSignals([makeBuy('btc')], state, noCooldownStrict, BASE_TIME);

        // Risk-control signal still passes despite daily cap reached
        const { accepted } = service.filterSignals([makeSignal()], state, noCooldownStrict, BASE_TIME + ONE_HOUR);
        expect(accepted).toHaveLength(1);
        expect(accepted[0].originalType).toBe(expectedType);
      });

      it.each([
        ['STOP_LOSS', () => makeStopLoss('btc')],
        ['TAKE_PROFIT', () => makeTakeProfit('btc')]
      ] as const)('%s respects cooldown', (_label, makeSignal) => {
        const state = service.createState();
        // First risk-control signal passes
        const { accepted: r1 } = service.filterSignals([makeSignal()], state, strictConfig, BASE_TIME);
        expect(r1).toHaveLength(1);

        // Second within cooldown is suppressed
        const { accepted: r2 } = service.filterSignals([makeSignal()], state, strictConfig, BASE_TIME + ONE_HOUR);
        expect(r2).toHaveLength(0);
      });

      it('bypass signals do not count against daily limit', () => {
        const state = service.createState();
        const capConfig: SignalThrottleConfig = { cooldownMs: 0, maxTradesPerDay: 2, minSellPercent: 0.5 };

        service.filterSignals([makeStopLoss('btc')], state, capConfig, BASE_TIME);
        service.filterSignals([makeTakeProfit('eth')], state, capConfig, BASE_TIME + 1000);

        const { accepted } = service.filterSignals([makeBuy('sol')], state, capConfig, BASE_TIME + 2000);
        expect(accepted).toHaveLength(1);
      });

      it('bypass signals set cooldown — blocks subsequent normal SELL for same coin', () => {
        const state = service.createState();
        service.filterSignals([makeStopLoss('btc')], state, config, BASE_TIME);

        // Normal SELL for same coin+direction within cooldown is suppressed
        const { accepted } = service.filterSignals([makeSell('btc', 0.8, 0.6)], state, config, BASE_TIME + ONE_HOUR);
        expect(accepted).toHaveLength(0);
      });

      it('bypass signals pass freely when cooldownMs is 0', () => {
        const state = service.createState();
        const noCooldown: SignalThrottleConfig = { cooldownMs: 0, maxTradesPerDay: 10, minSellPercent: 0 };

        const { accepted: r1 } = service.filterSignals([makeStopLoss('btc')], state, noCooldown, BASE_TIME);
        const { accepted: r2 } = service.filterSignals([makeStopLoss('btc')], state, noCooldown, BASE_TIME + 1);
        expect(r1).toHaveLength(1);
        expect(r2).toHaveLength(1);
      });
    });

    describe('min sell percentage', () => {
      it('SELL below floor gets percentage raised to minSellPercent', () => {
        const state = service.createState();
        const signal = makeSell('btc', 0.3, 0.3);
        const { accepted } = service.filterSignals([signal], state, config, BASE_TIME);
        expect(accepted).toHaveLength(1);
        expect(accepted[0].percentage).toBe(0.5);
      });

      it('SELL with undefined percentage gets floored to minSellPercent', () => {
        const state = service.createState();
        const signal = makeSell('btc', 0.3); // no percentage arg → undefined
        const { accepted } = service.filterSignals([signal], state, config, BASE_TIME);
        expect(accepted).toHaveLength(1);
        expect(accepted[0].percentage).toBe(0.5);
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
        const { accepted } = service.filterSignals([signal], state, config, BASE_TIME);
        expect(accepted).toHaveLength(1);
        expect(accepted[0].percentage).toBe(0.1);
      });

      it('high-confidence SELL above floor is NOT modified', () => {
        const state = service.createState();
        const signal = makeSell('btc', 0.9, 0.8);
        const { accepted } = service.filterSignals([signal], state, config, BASE_TIME);
        expect(accepted).toHaveLength(1);
        expect(accepted[0].percentage).toBe(0.8);
      });

      it('minSellPercent: 0 disables sell floor', () => {
        const state = service.createState();
        const noFloor: SignalThrottleConfig = { ...config, minSellPercent: 0 };
        const signal = makeSell('btc', 0.3, 0.1);
        const { accepted } = service.filterSignals([signal], state, noFloor, BASE_TIME);
        expect(accepted).toHaveLength(1);
        expect(accepted[0].percentage).toBe(0.1);
      });

      it('minSellPercent-bumped signal is in accepted, not rejected', () => {
        const state = service.createState();
        const signal = makeSell('btc', 0.3, 0.2);
        const { accepted, rejected } = service.filterSignals([signal], state, config, BASE_TIME);
        expect(accepted).toHaveLength(1);
        expect(accepted[0].percentage).toBe(0.5);
        expect(rejected).toHaveLength(0);
      });
    });

    it('should update state.lastSignalTime and state.tradeTimestamps on accepted signals', () => {
      const state = service.createState();
      service.filterSignals([makeBuy('btc')], state, config, BASE_TIME);

      expect(state.lastSignalTime['btc:BUY']).toBe(BASE_TIME);
      expect(state.tradeTimestamps).toEqual([BASE_TIME]);
    });
  });

  describe('resolveConfig', () => {
    it('returns defaults when params is undefined', () => {
      const config = service.resolveConfig(undefined);
      expect(config).toEqual({ cooldownMs: 86_400_000, maxTradesPerDay: 6, minSellPercent: 0.5 });
    });

    it('passes through valid values', () => {
      const config = service.resolveConfig({ cooldownMs: 3600_000, maxTradesPerDay: 10, minSellPercent: 0.3 });
      expect(config).toEqual({ cooldownMs: 3600_000, maxTradesPerDay: 10, minSellPercent: 0.3 });
    });

    it('clamps cooldownMs to [0, 604_800_000]', () => {
      expect(service.resolveConfig({ cooldownMs: -1 }).cooldownMs).toBe(0);
      expect(service.resolveConfig({ cooldownMs: 999_999_999 }).cooldownMs).toBe(604_800_000);
    });

    it('clamps maxTradesPerDay to [0, 50]', () => {
      expect(service.resolveConfig({ maxTradesPerDay: -5 }).maxTradesPerDay).toBe(0);
      expect(service.resolveConfig({ maxTradesPerDay: 100 }).maxTradesPerDay).toBe(50);
    });

    it('clamps minSellPercent to [0, 1]', () => {
      expect(service.resolveConfig({ minSellPercent: -0.1 }).minSellPercent).toBe(0);
      expect(service.resolveConfig({ minSellPercent: 1.5 }).minSellPercent).toBe(1);
    });

    it('falls back to defaults for non-numeric values', () => {
      const config = service.resolveConfig({
        cooldownMs: 'not-a-number',
        maxTradesPerDay: null,
        minSellPercent: true
      });
      expect(config).toEqual({ cooldownMs: 86_400_000, maxTradesPerDay: 6, minSellPercent: 0.5 });
    });

    it('falls back to defaults for NaN and Infinity', () => {
      const config = service.resolveConfig({
        cooldownMs: NaN,
        maxTradesPerDay: Infinity,
        minSellPercent: -Infinity
      });
      expect(config).toEqual({ cooldownMs: 86_400_000, maxTradesPerDay: 6, minSellPercent: 0.5 });
    });

    it('uses paper trading defaults when passed as second argument', () => {
      const config = service.resolveConfig(undefined, PAPER_TRADING_DEFAULT_THROTTLE_CONFIG);
      expect(config.cooldownMs).toBe(0);
      expect(config.maxTradesPerDay).toBe(6);
      expect(config.minSellPercent).toBe(0.5);
    });

    it('PAPER_TRADING_DEFAULT_THROTTLE_CONFIG: explicit param overrides default cooldownMs=0', () => {
      const config = service.resolveConfig({ cooldownMs: 3_600_000 }, PAPER_TRADING_DEFAULT_THROTTLE_CONFIG);
      expect(config.cooldownMs).toBe(3_600_000);
    });
  });

  describe('toThrottleSignal', () => {
    it.each([
      [AlgoSignalType.BUY, 'BUY'],
      [AlgoSignalType.SELL, 'SELL'],
      [AlgoSignalType.STOP_LOSS, 'SELL'],
      [AlgoSignalType.TAKE_PROFIT, 'SELL'],
      [AlgoSignalType.SHORT_ENTRY, 'OPEN_SHORT'],
      [AlgoSignalType.SHORT_EXIT, 'CLOSE_SHORT'],
      [AlgoSignalType.HOLD, 'HOLD']
    ] as const)('maps %s → %s', (type, expectedAction) => {
      const result = service.toThrottleSignal({
        type,
        coinId: 'btc',
        reason: 'test',
        confidence: 0.5,
        strength: 0.5
      });
      expect(result.action).toBe(expectedAction);
      expect(result.coinId).toBe('btc');
      expect(result.originalType).toBe(type);
    });

    it('preserves optional quantity field', () => {
      const result = service.toThrottleSignal({
        type: AlgoSignalType.SELL,
        coinId: 'eth',
        reason: 'sell all',
        confidence: 1.0,
        strength: 1.0,
        quantity: 2.5
      });
      expect(result.quantity).toBe(2.5);
    });

    it('preserves exitConfig when present', () => {
      const exitConfig = { enableStopLoss: true, stopLossValue: 5 };
      const result = service.toThrottleSignal({
        type: AlgoSignalType.BUY,
        coinId: 'btc',
        reason: 'test',
        confidence: 0.8,
        strength: 0.8,
        exitConfig
      });
      expect(result.exitConfig).toEqual(exitConfig);
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
