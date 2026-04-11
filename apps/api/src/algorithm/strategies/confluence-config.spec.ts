import { getConfluenceParameterConstraints } from './confluence-config';

import { GridSearchService } from '../../optimization/services/grid-search.service';

describe('getConfluenceParameterConstraints — minConfluence guard', () => {
  const gridSearch = new GridSearchService();
  const constraints = getConfluenceParameterConstraints();

  // Sensible defaults that satisfy the existing period-ordering constraints so
  // each test only exercises the new minConfluence guard in isolation.
  const baseParams = {
    emaFastPeriod: 12,
    emaSlowPeriod: 26,
    macdFastPeriod: 12,
    macdSlowPeriod: 26,
    rsiBuyThreshold: 55,
    rsiSellThreshold: 45,
    bbBuyThreshold: 0.55,
    bbSellThreshold: 0.45
  };

  it('rejects minConfluence > number of enabled directional indicators', () => {
    const params = {
      ...baseParams,
      emaEnabled: false,
      rsiEnabled: false,
      macdEnabled: false,
      bbEnabled: true,
      atrEnabled: true,
      minConfluence: 4
    };

    expect(gridSearch.validateConstraints(params, constraints)).toBe(false);
  });

  it('rejects minSellConfluence > number of enabled directional indicators', () => {
    const params = {
      ...baseParams,
      emaEnabled: true,
      rsiEnabled: true,
      macdEnabled: false,
      bbEnabled: false,
      minConfluence: 2,
      minSellConfluence: 3
    };

    expect(gridSearch.validateConstraints(params, constraints)).toBe(false);
  });

  it('does not count ATR toward the directional pool', () => {
    // 3 directional indicators enabled (EMA, RSI, MACD), ATR is filter-only.
    // minConfluence: 4 should fail even though 4 indicators total are enabled.
    const params = {
      ...baseParams,
      emaEnabled: true,
      rsiEnabled: true,
      macdEnabled: true,
      bbEnabled: false,
      atrEnabled: true,
      minConfluence: 4
    };

    expect(gridSearch.validateConstraints(params, constraints)).toBe(false);
  });

  it('accepts a combination where minConfluence equals enabled directional count', () => {
    const params = {
      ...baseParams,
      emaEnabled: true,
      rsiEnabled: true,
      macdEnabled: true,
      bbEnabled: true,
      atrEnabled: false,
      minConfluence: 4,
      minSellConfluence: 4
    };

    expect(gridSearch.validateConstraints(params, constraints)).toBe(true);
  });

  it('treats undefined indicator flags as enabled (matches getConfluenceIndicatorRequirements)', () => {
    // No *Enabled flags set explicitly — all four directional indicators count as enabled.
    const params = {
      ...baseParams,
      minConfluence: 3
    };

    expect(gridSearch.validateConstraints(params, constraints)).toBe(true);
  });

  it('defaults minSellConfluence to minConfluence when not provided', () => {
    const params = {
      ...baseParams,
      emaEnabled: true,
      rsiEnabled: false,
      macdEnabled: false,
      bbEnabled: false,
      minConfluence: 1
      // minSellConfluence omitted — should default to minConfluence (1) and pass
    };

    expect(gridSearch.validateConstraints(params, constraints)).toBe(true);
  });
});
