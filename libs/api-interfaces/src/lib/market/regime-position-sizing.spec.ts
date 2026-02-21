import {
  classifyCompositeRegime,
  CompositeRegimeType,
  DEFAULT_REGIME_MULTIPLIERS,
  determineVolatilityRegime,
  getRegimeMultiplier,
  MarketRegimeType,
  RISK_REGIME_MULTIPLIER_MATRIX
} from './market-regime.interface';

describe('getRegimeMultiplier', () => {
  it.each([
    [1, CompositeRegimeType.BULL, 1.0],
    [1, CompositeRegimeType.NEUTRAL, 0.4],
    [1, CompositeRegimeType.BEAR, 0.05],
    [1, CompositeRegimeType.EXTREME, 0.02],
    [5, CompositeRegimeType.BULL, 1.0],
    [5, CompositeRegimeType.NEUTRAL, 0.7],
    [5, CompositeRegimeType.BEAR, 0.2],
    [5, CompositeRegimeType.EXTREME, 0.1]
  ])('risk %i + %s → %f', (riskLevel, regime, expected) => {
    expect(getRegimeMultiplier(riskLevel, regime)).toBe(expected);
  });

  it('falls back to DEFAULT_REGIME_MULTIPLIERS for unknown risk level', () => {
    expect(getRegimeMultiplier(99, CompositeRegimeType.BULL)).toBe(
      DEFAULT_REGIME_MULTIPLIERS[CompositeRegimeType.BULL]
    );
    expect(getRegimeMultiplier(0, CompositeRegimeType.NEUTRAL)).toBe(
      DEFAULT_REGIME_MULTIPLIERS[CompositeRegimeType.NEUTRAL]
    );
    expect(getRegimeMultiplier(-1, CompositeRegimeType.BEAR)).toBe(
      DEFAULT_REGIME_MULTIPLIERS[CompositeRegimeType.BEAR]
    );
  });

  it('falls back to NEUTRAL default for unknown regime value', () => {
    expect(getRegimeMultiplier(3, 'unknown_regime' as CompositeRegimeType)).toBe(
      DEFAULT_REGIME_MULTIPLIERS[CompositeRegimeType.NEUTRAL]
    );
  });

  it('BEAR multiplier increases with risk level', () => {
    const bearValues = [1, 2, 3, 4, 5].map((risk) => getRegimeMultiplier(risk, CompositeRegimeType.BEAR));
    for (let i = 1; i < bearValues.length; i++) {
      expect(bearValues[i]).toBeGreaterThan(bearValues[i - 1]);
    }
  });

  it('EXTREME multiplier increases with risk level', () => {
    const extremeValues = [1, 2, 3, 4, 5].map((risk) => getRegimeMultiplier(risk, CompositeRegimeType.EXTREME));
    for (let i = 1; i < extremeValues.length; i++) {
      expect(extremeValues[i]).toBeGreaterThan(extremeValues[i - 1]);
    }
  });

  it('NEUTRAL multiplier increases with risk level', () => {
    const neutralValues = [1, 2, 3, 4, 5].map((risk) => getRegimeMultiplier(risk, CompositeRegimeType.NEUTRAL));
    for (let i = 1; i < neutralValues.length; i++) {
      expect(neutralValues[i]).toBeGreaterThan(neutralValues[i - 1]);
    }
  });
});

describe('RISK_REGIME_MULTIPLIER_MATRIX', () => {
  it('all multipliers are between 0 and 1 inclusive', () => {
    for (const [, multipliers] of Object.entries(RISK_REGIME_MULTIPLIER_MATRIX)) {
      for (const [, value] of Object.entries(multipliers)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('classifyCompositeRegime', () => {
  it.each([
    [MarketRegimeType.LOW_VOLATILITY, true, CompositeRegimeType.BULL],
    [MarketRegimeType.NORMAL, true, CompositeRegimeType.BULL],
    [MarketRegimeType.HIGH_VOLATILITY, true, CompositeRegimeType.NEUTRAL],
    [MarketRegimeType.EXTREME, true, CompositeRegimeType.NEUTRAL],
    [MarketRegimeType.LOW_VOLATILITY, false, CompositeRegimeType.BEAR],
    [MarketRegimeType.NORMAL, false, CompositeRegimeType.BEAR],
    [MarketRegimeType.HIGH_VOLATILITY, false, CompositeRegimeType.BEAR],
    [MarketRegimeType.EXTREME, false, CompositeRegimeType.EXTREME]
  ])('%s + trendAboveSma=%s → %s', (volatilityRegime, trendAboveSma, expected) => {
    expect(classifyCompositeRegime(volatilityRegime, trendAboveSma)).toBe(expected);
  });
});

describe('determineVolatilityRegime', () => {
  it.each([
    [0, MarketRegimeType.LOW_VOLATILITY],
    [24.9, MarketRegimeType.LOW_VOLATILITY],
    [25, MarketRegimeType.NORMAL],
    [50, MarketRegimeType.NORMAL],
    [74.9, MarketRegimeType.NORMAL],
    [75, MarketRegimeType.HIGH_VOLATILITY],
    [89.9, MarketRegimeType.HIGH_VOLATILITY],
    [90, MarketRegimeType.EXTREME],
    [100, MarketRegimeType.EXTREME]
  ])('percentile %f → %s', (percentile, expected) => {
    expect(determineVolatilityRegime(percentile)).toBe(expected);
  });
});
