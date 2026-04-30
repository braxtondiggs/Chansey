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
      // Persisting cooldown across batches now requires the caller to invoke
      // markExecuted — filterSignals no longer writes to state.lastSignalTime.
      const acceptAndMark = (
        signal: TradingSignal,
        state: ReturnType<typeof service.createState>,
        cfg: SignalThrottleConfig,
        ts: number
      ) => {
        service.filterSignals([signal], state, cfg, ts);
        service.markExecuted(state, signal, ts);
      };

      it('same coin+direction within cooldownMs is suppressed', () => {
        const state = service.createState();
        acceptAndMark(makeBuy('btc'), state, config, BASE_TIME);

        const { accepted } = service.filterSignals([makeBuy('btc')], state, config, BASE_TIME + ONE_HOUR);
        expect(accepted).toHaveLength(0);
      });

      it('BUY cooldown does not block SELL for same coin', () => {
        const state = service.createState();
        acceptAndMark(makeBuy('btc'), state, config, BASE_TIME);

        const { accepted } = service.filterSignals([makeSell('btc', 0.8, 0.6)], state, config, BASE_TIME + ONE_HOUR);
        expect(accepted).toHaveLength(1);
        expect(accepted[0].action).toBe('SELL');
      });

      it('BUY cooldown for BTC does not block BUY for ETH', () => {
        const state = service.createState();
        acceptAndMark(makeBuy('btc'), state, config, BASE_TIME);

        const { accepted } = service.filterSignals([makeBuy('eth')], state, config, BASE_TIME + ONE_HOUR);
        expect(accepted).toHaveLength(1);
        expect(accepted[0].coinId).toBe('eth');
      });

      it('signal passes after cooldownMs elapsed', () => {
        const state = service.createState();
        acceptAndMark(makeBuy('btc'), state, config, BASE_TIME);

        const { accepted } = service.filterSignals([makeBuy('btc')], state, config, BASE_TIME + ONE_DAY);
        expect(accepted).toHaveLength(1);
      });

      it('cooldownMs: 0 disables cooldown', () => {
        const state = service.createState();
        const noCooldown: SignalThrottleConfig = { ...config, cooldownMs: 0, maxTradesPerDay: 100 };

        acceptAndMark(makeBuy('btc'), state, noCooldown, BASE_TIME);
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
        acceptAndMark(makeBuy('btc'), state, config, BASE_TIME);

        const signal = makeBuy('btc');
        const { accepted, rejected } = service.filterSignals([signal], state, config, BASE_TIME + ONE_HOUR);
        expect(accepted).toHaveLength(0);
        expect(rejected).toHaveLength(1);
        expect(rejected[0]).toBe(signal);
      });
    });

    describe('daily trade limit', () => {
      // Both cooldown and daily-cap accounting moved out of filterSignals into
      // markExecuted, so these scenarios now mirror what callers do: filter,
      // then mark each accepted (non-bypass) signal as executed before the
      // next batch.
      const filterAndMark = (
        signals: TradingSignal[],
        state: ReturnType<typeof service.createState>,
        cfg: SignalThrottleConfig,
        ts: number
      ) => {
        const result = service.filterSignals(signals, state, cfg, ts);
        for (const s of result.accepted) {
          if (
            !s.originalType ||
            (s.originalType !== AlgoSignalType.STOP_LOSS &&
              s.originalType !== AlgoSignalType.TAKE_PROFIT &&
              s.originalType !== AlgoSignalType.SHORT_EXIT)
          ) {
            service.markExecuted(state, s, ts);
          }
        }
        return result;
      };

      it('signals suppressed after maxTradesPerDay reached', () => {
        const state = service.createState();
        const limitConfig: SignalThrottleConfig = { ...config, maxTradesPerDay: 2, cooldownMs: 0 };

        filterAndMark([makeBuy('btc')], state, limitConfig, BASE_TIME);
        filterAndMark([makeBuy('eth')], state, limitConfig, BASE_TIME + 1000);

        const { accepted } = filterAndMark([makeBuy('sol')], state, limitConfig, BASE_TIME + 2000);
        expect(accepted).toHaveLength(0);
      });

      it('24h rolling window prunes old entries', () => {
        const state = service.createState();
        const limitConfig: SignalThrottleConfig = { ...config, maxTradesPerDay: 2, cooldownMs: 0 };

        filterAndMark([makeBuy('btc')], state, limitConfig, BASE_TIME);
        filterAndMark([makeBuy('eth')], state, limitConfig, BASE_TIME + 1000);

        const { accepted } = filterAndMark([makeBuy('sol')], state, limitConfig, BASE_TIME + ONE_DAY + 1);
        expect(accepted).toHaveLength(1);
      });

      it('maxTradesPerDay: 0 disables daily cap', () => {
        const state = service.createState();
        const noCap: SignalThrottleConfig = { ...config, maxTradesPerDay: 0, cooldownMs: 0 };

        for (let i = 0; i < 20; i++) {
          const { accepted } = filterAndMark([makeBuy(`coin-${i}`)], state, noCap, BASE_TIME + i);
          expect(accepted).toHaveLength(1);
        }
      });

      it('filterSignals alone does NOT burn the daily cap until markExecuted is called', () => {
        const state = service.createState();
        const limitConfig: SignalThrottleConfig = { ...config, maxTradesPerDay: 2, cooldownMs: 0 };

        // Accepting two signals without calling markExecuted should leave cap untouched
        service.filterSignals([makeBuy('btc')], state, limitConfig, BASE_TIME);
        service.filterSignals([makeBuy('eth')], state, limitConfig, BASE_TIME + 1000);
        expect(state.tradeTimestamps).toEqual([]);

        // A third signal still passes — cap was never burned
        const { accepted } = service.filterSignals([makeBuy('sol')], state, limitConfig, BASE_TIME + 2000);
        expect(accepted).toHaveLength(1);
      });

      it('markExecuted updates the rolling 24h window', () => {
        const state = service.createState();
        service.markExecuted(state, makeBuy('btc'), BASE_TIME);
        service.markExecuted(state, makeBuy('eth'), BASE_TIME + 1000);
        expect(state.tradeTimestamps).toEqual([BASE_TIME, BASE_TIME + 1000]);
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
        // Fill daily cap with a normal trade. filterSignals no longer auto-bumps
        // the rolling window — the caller must mark execution explicitly.
        const noCooldownStrict: SignalThrottleConfig = { ...strictConfig, cooldownMs: 0 };
        const buy = makeBuy('btc');
        service.filterSignals([buy], state, noCooldownStrict, BASE_TIME);
        service.markExecuted(state, buy, BASE_TIME);

        // Risk-control signal still passes despite daily cap reached
        const { accepted } = service.filterSignals([makeSignal()], state, noCooldownStrict, BASE_TIME + ONE_HOUR);
        expect(accepted).toHaveLength(1);
        expect(accepted[0].originalType).toBe(expectedType);
      });

      it.each([
        ['STOP_LOSS', () => makeStopLoss('btc')],
        ['TAKE_PROFIT', () => makeTakeProfit('btc')]
      ] as const)('%s respects cooldown after markExecuted persists the stamp', (_label, makeSignal) => {
        const state = service.createState();
        // First risk-control signal passes
        const first = makeSignal();
        const { accepted: r1 } = service.filterSignals([first], state, strictConfig, BASE_TIME);
        expect(r1).toHaveLength(1);
        // markExecuted is the sole writer of lastSignalTime — caller must
        // invoke it to persist the cooldown stamp across batches.
        service.markExecuted(state, first, BASE_TIME);

        // Second within cooldown is suppressed
        const { accepted: r2 } = service.filterSignals([makeSignal()], state, strictConfig, BASE_TIME + ONE_HOUR);
        expect(r2).toHaveLength(0);
      });

      it('STOP_LOSS without markExecuted does NOT persist cooldown across batches', () => {
        const state = service.createState();
        // filterSignals alone no longer stamps lastSignalTime — held-coin
        // silent-drop scenarios that never reach markExecuted must not lock
        // out future signals on the same coin+direction.
        service.filterSignals([makeStopLoss('btc')], state, strictConfig, BASE_TIME);
        expect(state.lastSignalTime['btc:SELL']).toBeUndefined();

        const { accepted } = service.filterSignals([makeStopLoss('btc')], state, strictConfig, BASE_TIME + ONE_HOUR);
        expect(accepted).toHaveLength(1);
      });

      it('bypass signals do not count against daily limit', () => {
        const state = service.createState();
        const capConfig: SignalThrottleConfig = { cooldownMs: 0, maxTradesPerDay: 2, minSellPercent: 0.5 };

        // Bypass signals never call markExecuted in callers, so cap stays untouched.
        service.filterSignals([makeStopLoss('btc')], state, capConfig, BASE_TIME);
        service.filterSignals([makeTakeProfit('eth')], state, capConfig, BASE_TIME + 1000);

        const { accepted } = service.filterSignals([makeBuy('sol')], state, capConfig, BASE_TIME + 2000);
        expect(accepted).toHaveLength(1);
      });

      it('bypass signals set cooldown after markExecuted — blocks subsequent normal SELL for same coin', () => {
        const state = service.createState();
        const sl = makeStopLoss('btc');
        service.filterSignals([sl], state, config, BASE_TIME);
        // Caller must invoke markExecuted to persist the cooldown stamp.
        service.markExecuted(state, sl, BASE_TIME);

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

    it('filterSignals does NOT touch state; markExecuted is the sole writer of lastSignalTime and tradeTimestamps', () => {
      const state = service.createState();
      const buy = makeBuy('btc');
      service.filterSignals([buy], state, config, BASE_TIME);

      // Both ledgers stay untouched — neither cooldown stamp nor daily-cap
      // entry is written until the caller marks execution. This prevents
      // downstream silent drops (held-coin, insufficient funds, unresolved
      // symbols) from sliding the cooldown forward or burning the daily cap.
      expect(state.lastSignalTime['btc:BUY']).toBeUndefined();
      expect(state.tradeTimestamps).toEqual([]);

      service.markExecuted(state, buy, BASE_TIME);
      expect(state.lastSignalTime['btc:BUY']).toBe(BASE_TIME);
      expect(state.tradeTimestamps).toEqual([BASE_TIME]);
    });

    it('lastSignalTime is NOT stamped when filterSignals accepts but markExecuted is never called', () => {
      // Regression test for the held-coin silent-drop bug: filterSignals
      // accepts a BUY for a coin that's already held, the engine drops it
      // silently without invoking markExecuted, and the next BUY one bar
      // later must still pass the throttle (cooldown not slid forward).
      const state = service.createState();

      service.filterSignals([makeBuy('btc')], state, config, BASE_TIME);
      // Engine silently drops the signal — markExecuted is never called.
      expect(state.lastSignalTime['btc:BUY']).toBeUndefined();

      // Subsequent BUY one hour later still passes — cooldown wasn't burned.
      const { accepted } = service.filterSignals([makeBuy('btc')], state, config, BASE_TIME + ONE_HOUR);
      expect(accepted).toHaveLength(1);
    });

    it('intra-batch dedup rejects same coin+direction duplicates without persisting state', () => {
      const state = service.createState();
      const signals = [makeBuy('btc'), makeBuy('btc'), makeBuy('btc')];
      const { accepted, rejected } = service.filterSignals(signals, state, config, BASE_TIME);
      expect(accepted).toHaveLength(1);
      expect(rejected).toHaveLength(2);
      // Persistent ledger remains empty — dedup is transient.
      expect(state.lastSignalTime['btc:BUY']).toBeUndefined();
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
      expect(config.cooldownMs).toBe(60 * 60 * 1000);
      expect(config.maxTradesPerDay).toBe(6);
      expect(config.minSellPercent).toBe(0.5);
    });

    it('PAPER_TRADING_DEFAULT_THROTTLE_CONFIG: explicit param overrides default cooldownMs', () => {
      const config = service.resolveConfig({ cooldownMs: 0 }, PAPER_TRADING_DEFAULT_THROTTLE_CONFIG);
      expect(config.cooldownMs).toBe(0);
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
      const buy = makeBuy('btc');
      const sell = makeSell('eth', 0.8, 0.6);
      service.filterSignals([buy, sell], state, DEFAULT_THROTTLE_CONFIG, BASE_TIME);
      service.markExecuted(state, buy, BASE_TIME);
      service.markExecuted(state, sell, BASE_TIME);

      const serialized = service.serialize(state);
      const restored = service.deserialize(serialized);

      expect(restored.lastSignalTime).toEqual(state.lastSignalTime);
      expect(restored.tradeTimestamps).toEqual(state.tradeTimestamps);

      // Ensure it's a deep copy — mutations don't leak
      restored.tradeTimestamps.push(999);
      expect(state.tradeTimestamps).not.toContain(999);
    });
  });

  describe('markExecutedFromAlgo', () => {
    it('returns false when state is undefined', () => {
      const result = service.markExecutedFromAlgo(undefined, AlgoSignalType.BUY, 'btc', BASE_TIME);
      expect(result).toBe(false);
    });

    it('returns false when signalType is undefined', () => {
      const state = service.createState();
      const result = service.markExecutedFromAlgo(state, undefined, 'btc', BASE_TIME);
      expect(result).toBe(false);
      expect(state.lastSignalTime).toEqual({});
      expect(state.tradeTimestamps).toEqual([]);
    });

    it('returns false when coinId is undefined', () => {
      const state = service.createState();
      const result = service.markExecutedFromAlgo(state, AlgoSignalType.BUY, undefined, BASE_TIME);
      expect(result).toBe(false);
      expect(state.lastSignalTime).toEqual({});
    });

    it('returns false and skips stamping for STOP_LOSS bypass type', () => {
      const state = service.createState();
      const result = service.markExecutedFromAlgo(state, AlgoSignalType.STOP_LOSS, 'btc', BASE_TIME);
      expect(result).toBe(false);
      expect(state.lastSignalTime).toEqual({});
      expect(state.tradeTimestamps).toEqual([]);
    });

    it('returns false and skips stamping for TAKE_PROFIT bypass type', () => {
      const state = service.createState();
      const result = service.markExecutedFromAlgo(state, AlgoSignalType.TAKE_PROFIT, 'btc', BASE_TIME);
      expect(result).toBe(false);
    });

    it('returns false and skips stamping for SHORT_EXIT bypass type', () => {
      const state = service.createState();
      const result = service.markExecutedFromAlgo(state, AlgoSignalType.SHORT_EXIT, 'btc', BASE_TIME);
      expect(result).toBe(false);
    });

    it('returns false for HOLD signal type', () => {
      const state = service.createState();
      const result = service.markExecutedFromAlgo(state, AlgoSignalType.HOLD, 'btc', BASE_TIME);
      expect(result).toBe(false);
    });

    it('stamps the throttle ledger for a regular BUY signal', () => {
      const state = service.createState();
      const result = service.markExecutedFromAlgo(state, AlgoSignalType.BUY, 'btc', BASE_TIME);
      expect(result).toBe(true);
      expect(state.lastSignalTime).toEqual({ 'btc:BUY': BASE_TIME });
      expect(state.tradeTimestamps).toEqual([BASE_TIME]);
    });

    it('stamps the throttle ledger for a regular SELL signal', () => {
      const state = service.createState();
      const result = service.markExecutedFromAlgo(state, AlgoSignalType.SELL, 'eth', BASE_TIME);
      expect(result).toBe(true);
      expect(state.lastSignalTime).toEqual({ 'eth:SELL': BASE_TIME });
    });

    it('stamps OPEN_SHORT for SHORT_ENTRY signal', () => {
      const state = service.createState();
      const result = service.markExecutedFromAlgo(state, AlgoSignalType.SHORT_ENTRY, 'btc', BASE_TIME);
      expect(result).toBe(true);
      expect(state.lastSignalTime).toEqual({ 'btc:OPEN_SHORT': BASE_TIME });
    });
  });
});
