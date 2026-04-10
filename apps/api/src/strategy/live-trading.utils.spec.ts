import { calculateFreeUsdValue, estimatePortfolioCapital, extractCoinIdFromSymbol } from './live-trading.utils';

import { type ExchangeBalanceDto } from '../balance/dto';

function makeExchange(balances: Array<{ free?: string; locked?: string; usdValue?: number }>): ExchangeBalanceDto {
  return {
    exchangeName: 'test',
    balances: balances.map((b) => ({
      currency: 'USD',
      free: b.free,
      locked: b.locked,
      total: '0',
      usdValue: b.usdValue
    }))
  } as unknown as ExchangeBalanceDto;
}

describe('calculateFreeUsdValue', () => {
  it('returns 0 for empty exchanges array', () => {
    expect(calculateFreeUsdValue([])).toBe(0);
  });

  it('calculates free USD proportion for a single balance', () => {
    const exchanges = [makeExchange([{ free: '60', locked: '40', usdValue: 1000 }])];
    // free portion = 60/100 * 1000 = 600
    expect(calculateFreeUsdValue(exchanges)).toBeCloseTo(600);
  });

  it('sums across multiple exchanges', () => {
    const exchanges = [
      makeExchange([{ free: '50', locked: '50', usdValue: 200 }]),
      makeExchange([{ free: '100', locked: '0', usdValue: 500 }])
    ];
    // 50/100 * 200 + 100/100 * 500 = 100 + 500 = 600
    expect(calculateFreeUsdValue(exchanges)).toBeCloseTo(600);
  });

  it('skips balances with zero total amount (no division by zero)', () => {
    const exchanges = [makeExchange([{ free: '0', locked: '0', usdValue: 100 }])];
    expect(calculateFreeUsdValue(exchanges)).toBe(0);
  });

  it('defaults missing free/locked fields to 0', () => {
    const exchanges = [makeExchange([{ usdValue: 100 }])];
    expect(calculateFreeUsdValue(exchanges)).toBe(0);
  });
});

describe('estimatePortfolioCapital', () => {
  it('returns 1 for empty exchanges (minimum guard)', () => {
    expect(estimatePortfolioCapital([])).toBe(1);
  });

  it('sums usdValue across balances', () => {
    const exchanges = [makeExchange([{ usdValue: 300 }, { usdValue: 700 }])];
    expect(estimatePortfolioCapital(exchanges)).toBeCloseTo(1000);
  });

  it('returns 1 when total is zero', () => {
    const exchanges = [makeExchange([{ usdValue: 0 }])];
    expect(estimatePortfolioCapital(exchanges)).toBe(1);
  });
});

describe('extractCoinIdFromSymbol', () => {
  it('extracts base coin from standard pair', () => {
    expect(extractCoinIdFromSymbol('BTC/USDT')).toBe('BTC');
  });

  it('extracts base coin from USD pair', () => {
    expect(extractCoinIdFromSymbol('ETH/USD')).toBe('ETH');
  });

  it('returns symbol as-is when no separator', () => {
    expect(extractCoinIdFromSymbol('BTCUSDT')).toBe('BTCUSDT');
  });
});
