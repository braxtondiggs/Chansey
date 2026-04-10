import { resolveExitConfig } from './exit-config-merge.util';

import { DEFAULT_EXIT_CONFIG, type ExitConfig, StopLossType } from '../interfaces/exit-config.interface';

describe('resolveExitConfig', () => {
  it('should return DEFAULT_EXIT_CONFIG when called with no layers', () => {
    expect(resolveExitConfig()).toEqual(DEFAULT_EXIT_CONFIG);
  });

  it('should skip undefined and empty layers without altering defaults', () => {
    expect(resolveExitConfig(undefined, {}, undefined)).toEqual(DEFAULT_EXIT_CONFIG);
  });

  it('should apply a single partial layer over defaults', () => {
    const result = resolveExitConfig({ enableStopLoss: true, stopLossValue: 5 });

    expect(result.enableStopLoss).toBe(true);
    expect(result.stopLossValue).toBe(5);
    // Other defaults preserved
    expect(result.stopLossType).toBe(DEFAULT_EXIT_CONFIG.stopLossType);
    expect(result.enableTakeProfit).toBe(DEFAULT_EXIT_CONFIG.enableTakeProfit);
  });

  it('should apply layers in priority order (last wins)', () => {
    const userConfig: Partial<ExitConfig> = {
      enableStopLoss: true,
      stopLossValue: 3,
      enableTakeProfit: true,
      takeProfitValue: 6
    };

    const signalConfig: Partial<ExitConfig> = {
      stopLossValue: 2,
      takeProfitValue: 10
    };

    const result = resolveExitConfig(userConfig, signalConfig);

    expect(result.enableStopLoss).toBe(true); // from user (not overridden)
    expect(result.stopLossValue).toBe(2); // signal overrides user
    expect(result.enableTakeProfit).toBe(true); // from user (not overridden)
    expect(result.takeProfitValue).toBe(10); // signal overrides user
  });

  it('should not override lower layers when higher layers omit keys', () => {
    const userConfig: Partial<ExitConfig> = {
      enableStopLoss: true,
      stopLossValue: 5,
      stopLossType: StopLossType.ATR
    };

    const signalConfig: Partial<ExitConfig> = {
      stopLossValue: 3
      // stopLossType not set — should keep ATR from userConfig
    };

    const result = resolveExitConfig(userConfig, signalConfig);

    expect(result.stopLossType).toBe(StopLossType.ATR);
    expect(result.stopLossValue).toBe(3);
  });

  it('should not override lower layers when higher layers have explicit undefined', () => {
    const userConfig: Partial<ExitConfig> = {
      stopLossValue: 5,
      atrPeriod: 20
    };

    const signalConfig: Partial<ExitConfig> = {
      stopLossValue: undefined,
      atrPeriod: undefined
    };

    const result = resolveExitConfig(userConfig, signalConfig);

    expect(result.stopLossValue).toBe(5);
    expect(result.atrPeriod).toBe(20);
  });

  it('should apply falsy-but-defined values (false, 0)', () => {
    const layer: Partial<ExitConfig> = {
      enableStopLoss: false,
      stopLossValue: 0,
      useOco: false
    };

    const result = resolveExitConfig({ enableStopLoss: true, stopLossValue: 5, useOco: true }, layer);

    expect(result.enableStopLoss).toBe(false);
    expect(result.stopLossValue).toBe(0);
    expect(result.useOco).toBe(false);
  });
});
