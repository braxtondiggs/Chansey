import { BacktestExitTracker } from './backtest-exit-tracker';
import { DEFAULT_BACKTEST_EXIT_CONFIG } from './exit-price.utils';

import {
  ExitConfig,
  StopLossType,
  TakeProfitType,
  TrailingActivationType,
  TrailingType
} from '../../../interfaces/exit-config.interface';

function makeConfig(overrides: Partial<ExitConfig> = {}): ExitConfig {
  return { ...DEFAULT_BACKTEST_EXIT_CONFIG, ...overrides };
}

function makePriceMap(entries: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(entries));
}

describe('BacktestExitTracker', () => {
  describe('onBuy', () => {
    it('creates tracked exit with correct SL level for default 5% config', () => {
      const config = makeConfig();
      const tracker = new BacktestExitTracker(config);
      tracker.onBuy('btc', 100, 1);

      const levels = tracker.getExitLevels('btc');
      if (!levels) throw new Error('expected levels');
      expect(levels.stopLossPrice).toBe(95); // 5% below 100
      expect(levels.takeProfitPrice).toBeUndefined();
      expect(levels.trailingStopPrice).toBeUndefined();
      expect(tracker.size).toBe(1);
    });

    it('creates tracked exit with all exit levels', () => {
      const config = makeConfig({
        enableStopLoss: true,
        stopLossType: StopLossType.PERCENTAGE,
        stopLossValue: 5,
        enableTakeProfit: true,
        takeProfitType: TakeProfitType.PERCENTAGE,
        takeProfitValue: 10,
        enableTrailingStop: true,
        trailingType: TrailingType.PERCENTAGE,
        trailingValue: 3,
        trailingActivation: TrailingActivationType.IMMEDIATE,
        useOco: true
      });
      const tracker = new BacktestExitTracker(config);
      tracker.onBuy('eth', 2000, 5);

      const levels = tracker.getExitLevels('eth');
      if (!levels) throw new Error('expected levels');
      expect(levels.stopLossPrice).toBe(1900); // 5% of 2000 = 100, 2000 - 100 = 1900
      expect(levels.takeProfitPrice).toBe(2200); // 10% of 2000 = 200, 2000 + 200 = 2200
      expect(levels.trailingStopPrice).toBe(1940); // 3% of 2000 = 60, 2000 - 60 = 1940
      expect(levels.trailingActivated).toBe(true); // IMMEDIATE
    });

    it('applies overrideExitConfig for per-position config', () => {
      const baseConfig = makeConfig({
        enableStopLoss: true,
        stopLossType: StopLossType.PERCENTAGE,
        stopLossValue: 5
      });
      const tracker = new BacktestExitTracker(baseConfig);

      // Override SL to 10% for this specific position
      tracker.onBuy('btc', 100, 1, undefined, { stopLossValue: 10 });

      const levels = tracker.getExitLevels('btc');
      if (!levels) throw new Error('expected levels');
      expect(levels.stopLossPrice).toBe(90); // 10% below 100, not 5%
      expect(levels.positionConfig).toBeDefined();
    });
  });

  describe('onBuy — cost averaging', () => {
    it('buying same coin twice averages entry, sums quantity, and recalculates SL', () => {
      const config = makeConfig({
        enableStopLoss: true,
        stopLossType: StopLossType.PERCENTAGE,
        stopLossValue: 5
      });
      const tracker = new BacktestExitTracker(config);

      tracker.onBuy('btc', 100, 1); // SL at 95
      tracker.onBuy('btc', 120, 1); // avg entry = 110, SL at 104.5

      const levels = tracker.getExitLevels('btc');
      if (!levels) throw new Error('expected levels');
      expect(levels.entryPrice).toBe(110); // (100*1 + 120*1) / 2
      expect(levels.quantity).toBe(2);
      expect(levels.stopLossPrice).toBeCloseTo(104.5); // 5% below 110
      expect(tracker.size).toBe(1); // still one position
    });

    it('preserves trailing activation state when adding to position', () => {
      const config = makeConfig({
        enableStopLoss: false,
        enableTrailingStop: true,
        trailingType: TrailingType.PERCENTAGE,
        trailingValue: 3,
        trailingActivation: TrailingActivationType.PERCENTAGE,
        trailingActivationValue: 5
      });
      const tracker = new BacktestExitTracker(config);

      tracker.onBuy('btc', 100, 1);
      // Activate trailing by reaching 5% gain
      tracker.checkExits(makePriceMap({ btc: 106 }), makePriceMap({ btc: 104 }), makePriceMap({ btc: 106 }));
      const levelsAfterActivation = tracker.getExitLevels('btc');
      if (!levelsAfterActivation) throw new Error('expected levels');
      expect(levelsAfterActivation.trailingActivated).toBe(true);

      // Scale in — trailing activation should be preserved
      tracker.onBuy('btc', 108, 1);
      const levelsAfterScaleIn = tracker.getExitLevels('btc');
      if (!levelsAfterScaleIn) throw new Error('expected levels');
      expect(levelsAfterScaleIn.trailingActivated).toBe(true);
      expect(levelsAfterScaleIn.quantity).toBe(2);
    });

    it('updates highWaterMark to max of existing and new entry', () => {
      const config = makeConfig({
        enableStopLoss: true,
        stopLossType: StopLossType.PERCENTAGE,
        stopLossValue: 5
      });
      const tracker = new BacktestExitTracker(config);

      tracker.onBuy('btc', 100, 1);
      // Price goes up, check exits updates nothing but we can verify HWM after
      tracker.checkExits(makePriceMap({ btc: 130 }), makePriceMap({ btc: 125 }), makePriceMap({ btc: 130 }));
      const levelsBeforeScaleIn = tracker.getExitLevels('btc');
      if (!levelsBeforeScaleIn) throw new Error('expected levels');
      expect(levelsBeforeScaleIn.highWaterMark).toBe(100); // no trailing, HWM stays at entry

      // Scale in at higher price
      tracker.onBuy('btc', 150, 1);
      const levelsAfterScaleIn = tracker.getExitLevels('btc');
      if (!levelsAfterScaleIn) throw new Error('expected levels');
      expect(levelsAfterScaleIn.highWaterMark).toBe(150); // max(100, 150)
    });
  });

  describe('checkExits — Stop Loss', () => {
    it('triggers SL when low breaches stop level', () => {
      const config = makeConfig({
        enableStopLoss: true,
        stopLossType: StopLossType.PERCENTAGE,
        stopLossValue: 5
      });
      const tracker = new BacktestExitTracker(config);
      tracker.onBuy('btc', 100, 1);

      const signals = tracker.checkExits(
        makePriceMap({ btc: 94 }),
        makePriceMap({ btc: 94 }), // low breaches 95
        makePriceMap({ btc: 100 })
      );

      expect(signals).toHaveLength(1);
      expect(signals[0].exitType).toBe('STOP_LOSS');
      expect(signals[0].coinId).toBe('btc');
      expect(signals[0].quantity).toBe(1);
      expect(signals[0].executionPrice).toBe(95); // clamped to stop level
    });

    it('does not trigger SL when low is above stop level', () => {
      const config = makeConfig({
        enableStopLoss: true,
        stopLossType: StopLossType.PERCENTAGE,
        stopLossValue: 5
      });
      const tracker = new BacktestExitTracker(config);
      tracker.onBuy('btc', 100, 1);

      const signals = tracker.checkExits(
        makePriceMap({ btc: 96 }),
        makePriceMap({ btc: 96 }),
        makePriceMap({ btc: 100 })
      );

      expect(signals).toHaveLength(0);
    });
  });

  describe('checkExits — Take Profit', () => {
    it('triggers TP when high breaches TP level', () => {
      const config = makeConfig({
        enableStopLoss: false,
        enableTakeProfit: true,
        takeProfitType: TakeProfitType.PERCENTAGE,
        takeProfitValue: 10
      });
      const tracker = new BacktestExitTracker(config);
      tracker.onBuy('eth', 100, 2);

      const signals = tracker.checkExits(
        makePriceMap({ eth: 112 }),
        makePriceMap({ eth: 105 }),
        makePriceMap({ eth: 112 }) // high breaches 110
      );

      expect(signals).toHaveLength(1);
      expect(signals[0].exitType).toBe('TAKE_PROFIT');
      expect(signals[0].executionPrice).toBe(110); // clamped to TP level
      expect(signals[0].quantity).toBe(2);
    });

    it('does not trigger TP when high is below TP level', () => {
      const config = makeConfig({
        enableStopLoss: false,
        enableTakeProfit: true,
        takeProfitType: TakeProfitType.PERCENTAGE,
        takeProfitValue: 10
      });
      const tracker = new BacktestExitTracker(config);
      tracker.onBuy('eth', 100, 2);

      const signals = tracker.checkExits(
        makePriceMap({ eth: 108 }),
        makePriceMap({ eth: 105 }),
        makePriceMap({ eth: 109 })
      );

      expect(signals).toHaveLength(0);
    });
  });

  describe('checkExits — OCO behavior', () => {
    it('only one exit per position per bar when both SL and TP could trigger', () => {
      const config = makeConfig({
        enableStopLoss: true,
        stopLossType: StopLossType.PERCENTAGE,
        stopLossValue: 5,
        enableTakeProfit: true,
        takeProfitType: TakeProfitType.PERCENTAGE,
        takeProfitValue: 10,
        useOco: true
      });
      const tracker = new BacktestExitTracker(config);
      tracker.onBuy('btc', 100, 1);

      // Wide candle that breaches both SL (95) and TP (110)
      const signals = tracker.checkExits(
        makePriceMap({ btc: 90 }),
        makePriceMap({ btc: 80 }),
        makePriceMap({ btc: 120 })
      );

      // SL is checked first, so only SL should fire
      expect(signals).toHaveLength(1);
      expect(signals[0].exitType).toBe('STOP_LOSS');
    });
  });

  describe('checkExits — Trailing Stop', () => {
    it('trailing activates and ratchets with high water mark', () => {
      const config = makeConfig({
        enableStopLoss: false,
        enableTakeProfit: false,
        enableTrailingStop: true,
        trailingType: TrailingType.PERCENTAGE,
        trailingValue: 5,
        trailingActivation: TrailingActivationType.IMMEDIATE
      });
      const tracker = new BacktestExitTracker(config);
      tracker.onBuy('btc', 100, 1);

      // Price moves up, trailing ratchets
      let signals = tracker.checkExits(
        makePriceMap({ btc: 110 }),
        makePriceMap({ btc: 105 }),
        makePriceMap({ btc: 110 })
      );
      expect(signals).toHaveLength(0);

      // Check the trailing has ratcheted: HWM=110, trailing=110*(1-0.05)=104.5
      const levels = tracker.getExitLevels('btc');
      if (!levels) throw new Error('expected levels');
      expect(levels.highWaterMark).toBe(110);
      expect(levels.trailingStopPrice).toBeCloseTo(104.5);

      // Low breaches the ratcheted trailing stop
      signals = tracker.checkExits(makePriceMap({ btc: 104 }), makePriceMap({ btc: 103 }), makePriceMap({ btc: 110 }));
      expect(signals).toHaveLength(1);
      expect(signals[0].exitType).toBe('TRAILING_STOP');
      expect(signals[0].executionPrice).toBeCloseTo(104.5);
    });

    it('trailing does not activate until activation price is reached', () => {
      const config = makeConfig({
        enableStopLoss: false,
        enableTakeProfit: false,
        enableTrailingStop: true,
        trailingType: TrailingType.PERCENTAGE,
        trailingValue: 3,
        trailingActivation: TrailingActivationType.PERCENTAGE,
        trailingActivationValue: 5
      });
      const tracker = new BacktestExitTracker(config);
      tracker.onBuy('btc', 100, 1);
      // Activation at 105 (5% gain from entry)

      // Price moves up to 103 — not enough to activate
      let signals = tracker.checkExits(
        makePriceMap({ btc: 103 }),
        makePriceMap({ btc: 100 }),
        makePriceMap({ btc: 103 })
      );
      expect(signals).toHaveLength(0);
      const levelsBeforeActivation = tracker.getExitLevels('btc');
      if (!levelsBeforeActivation) throw new Error('expected levels');
      expect(levelsBeforeActivation.trailingActivated).toBe(false);

      // Price reaches 106 — activates
      signals = tracker.checkExits(makePriceMap({ btc: 106 }), makePriceMap({ btc: 104 }), makePriceMap({ btc: 106 }));
      expect(signals).toHaveLength(0);
      const levelsAfterActivation = tracker.getExitLevels('btc');
      if (!levelsAfterActivation) throw new Error('expected levels');
      expect(levelsAfterActivation.trailingActivated).toBe(true);
    });

    it('trailing with AMOUNT type ratchets from high water mark', () => {
      const config = makeConfig({
        enableStopLoss: false,
        enableTakeProfit: false,
        enableTrailingStop: true,
        trailingType: TrailingType.AMOUNT,
        trailingValue: 10,
        trailingActivation: TrailingActivationType.IMMEDIATE
      });
      const tracker = new BacktestExitTracker(config);
      tracker.onBuy('btc', 100, 1);

      // Initial trailing = 100 - 10 = 90. Price rises to 120 → HWM=120, trailing = 120-10 = 110
      tracker.checkExits(makePriceMap({ btc: 120 }), makePriceMap({ btc: 115 }), makePriceMap({ btc: 120 }));
      const levels = tracker.getExitLevels('btc');
      if (!levels) throw new Error('expected levels');
      expect(levels.trailingStopPrice).toBe(110);

      // Low breaches 110
      const signals = tracker.checkExits(
        makePriceMap({ btc: 109 }),
        makePriceMap({ btc: 108 }),
        makePriceMap({ btc: 115 })
      );
      expect(signals).toHaveLength(1);
      expect(signals[0].exitType).toBe('TRAILING_STOP');
      expect(signals[0].executionPrice).toBe(110);
    });

    it('ATR trailing falls back to 1% when entryAtr is undefined', () => {
      const config = makeConfig({
        enableStopLoss: false,
        enableTakeProfit: false,
        enableTrailingStop: true,
        trailingType: TrailingType.ATR,
        trailingValue: 2,
        trailingActivation: TrailingActivationType.IMMEDIATE
      });
      const tracker = new BacktestExitTracker(config);
      // No ATR provided — recalcTrailingStop should fall back to 1%
      tracker.onBuy('btc', 1000, 1);

      // Price rises to 1100 → HWM=1100, trailing = 1100 - (1100 * 0.01) = 1089
      tracker.checkExits(makePriceMap({ btc: 1100 }), makePriceMap({ btc: 1050 }), makePriceMap({ btc: 1100 }));
      const levels = tracker.getExitLevels('btc');
      if (!levels) throw new Error('expected levels');
      expect(levels.trailingStopPrice).toBe(1089); // 1% of HWM 1100 = 11, 1100 - 11 = 1089
    });
  });

  describe('checkExits — edge cases', () => {
    it('skips position when close price is zero or missing', () => {
      const config = makeConfig({ enableStopLoss: true, stopLossType: StopLossType.PERCENTAGE, stopLossValue: 5 });
      const tracker = new BacktestExitTracker(config);
      tracker.onBuy('btc', 100, 1);
      tracker.onBuy('eth', 200, 2);

      // btc has close=0 (skipped), eth has no entry at all (skipped)
      const signals = tracker.checkExits(
        makePriceMap({ btc: 0 }),
        makePriceMap({ btc: 50 }),
        makePriceMap({ btc: 100 })
      );

      expect(signals).toHaveLength(0);
      // Both positions still tracked — they weren't exited, just skipped
      expect(tracker.size).toBe(2);
    });

    it('checks multiple positions independently in one call', () => {
      const config = makeConfig({
        enableStopLoss: true,
        stopLossType: StopLossType.PERCENTAGE,
        stopLossValue: 5
      });
      const tracker = new BacktestExitTracker(config);
      tracker.onBuy('btc', 100, 1); // SL at 95
      tracker.onBuy('eth', 200, 2); // SL at 190

      const signals = tracker.checkExits(
        makePriceMap({ btc: 94, eth: 195 }),
        makePriceMap({ btc: 93, eth: 192 }), // btc breaches 95, eth stays above 190
        makePriceMap({ btc: 100, eth: 200 })
      );

      expect(signals).toHaveLength(1);
      expect(signals[0].coinId).toBe('btc');
      expect(tracker.has('eth')).toBe(true);
    });

    it('does not auto-remove position after exit signal', () => {
      const config = makeConfig({
        enableStopLoss: true,
        stopLossType: StopLossType.PERCENTAGE,
        stopLossValue: 5
      });
      const tracker = new BacktestExitTracker(config);
      tracker.onBuy('btc', 100, 1);

      const signals = tracker.checkExits(
        makePriceMap({ btc: 90 }),
        makePriceMap({ btc: 90 }),
        makePriceMap({ btc: 100 })
      );

      expect(signals).toHaveLength(1);
      // Position still exists — engine is responsible for calling onSell/removePosition
      expect(tracker.has('btc')).toBe(true);
      expect(tracker.size).toBe(1);
    });

    it('falls back to close price when low/high maps are missing for a coin', () => {
      const config = makeConfig({
        enableStopLoss: true,
        stopLossType: StopLossType.PERCENTAGE,
        stopLossValue: 5
      });
      const tracker = new BacktestExitTracker(config);
      tracker.onBuy('btc', 100, 1); // SL at 95

      // Only close provided, low/high maps don't include 'btc'
      const signals = tracker.checkExits(
        makePriceMap({ btc: 94 }),
        makePriceMap({}), // no low — falls back to close (94)
        makePriceMap({}) // no high — falls back to close (94)
      );

      // low defaults to close=94, which breaches SL at 95
      expect(signals).toHaveLength(1);
      expect(signals[0].exitType).toBe('STOP_LOSS');
    });
  });

  describe('onSell', () => {
    it('reduces quantity and removes at zero', () => {
      const config = makeConfig();
      const tracker = new BacktestExitTracker(config);
      tracker.onBuy('btc', 100, 5);

      tracker.onSell('btc', 3);
      expect(tracker.has('btc')).toBe(true);
      const levelsAfterSell = tracker.getExitLevels('btc');
      if (!levelsAfterSell) throw new Error('expected levels');
      expect(levelsAfterSell.quantity).toBe(2);

      tracker.onSell('btc', 2);
      expect(tracker.has('btc')).toBe(false);
      expect(tracker.size).toBe(0);
    });

    it('removes position when oversold (quantity goes negative)', () => {
      const config = makeConfig();
      const tracker = new BacktestExitTracker(config);
      tracker.onBuy('btc', 100, 1);

      tracker.onSell('btc', 5); // sell more than held
      expect(tracker.has('btc')).toBe(false);
    });
  });

  describe('serialize / deserialize', () => {
    it('round-trips correctly and restored tracker produces correct signals', () => {
      const config = makeConfig({
        enableStopLoss: true,
        stopLossType: StopLossType.PERCENTAGE,
        stopLossValue: 5,
        enableTakeProfit: true,
        takeProfitType: TakeProfitType.PERCENTAGE,
        takeProfitValue: 10,
        enableTrailingStop: true,
        trailingType: TrailingType.PERCENTAGE,
        trailingValue: 3,
        trailingActivation: TrailingActivationType.IMMEDIATE,
        useOco: true
      });
      const tracker = new BacktestExitTracker(config);
      tracker.onBuy('btc', 50000, 0.5);
      tracker.onBuy('eth', 3000, 10);

      // Advance trailing to set high water mark
      tracker.checkExits(
        makePriceMap({ btc: 52000, eth: 3200 }),
        makePriceMap({ btc: 50000, eth: 3000 }),
        makePriceMap({ btc: 52000, eth: 3200 })
      );

      const serialized = tracker.serialize();
      const restored = BacktestExitTracker.deserialize(serialized, config);

      // Verify data integrity
      expect(restored.size).toBe(2);
      const btcLevels = restored.getExitLevels('btc');
      const originalBtcLevels = tracker.getExitLevels('btc');
      if (!btcLevels) throw new Error('expected btcLevels');
      if (!originalBtcLevels) throw new Error('expected originalBtcLevels');
      expect(btcLevels.stopLossPrice).toBe(originalBtcLevels.stopLossPrice);
      expect(btcLevels.takeProfitPrice).toBe(originalBtcLevels.takeProfitPrice);
      expect(btcLevels.highWaterMark).toBe(originalBtcLevels.highWaterMark);
      expect(btcLevels.trailingActivated).toBe(originalBtcLevels.trailingActivated);

      // Verify functional correctness: restored tracker produces correct exit signal
      // ETH trailing stop is at 3104 (3% below HWM 3200), so keep ETH low above that
      const signals = restored.checkExits(
        makePriceMap({ btc: 47000, eth: 3150 }),
        makePriceMap({ btc: 47000, eth: 3110 }), // btc breaches SL at 47500, eth stays safe
        makePriceMap({ btc: 50000, eth: 3200 })
      );
      expect(signals).toHaveLength(1);
      expect(signals[0].coinId).toBe('btc');
      expect(signals[0].exitType).toBe('STOP_LOSS');
    });
  });
});
