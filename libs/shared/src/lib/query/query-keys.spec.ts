import { queryKeys } from './query-keys';

describe('query-keys', () => {
  it('builds coin keys with filters and nested resources', () => {
    expect(queryKeys.coins.all).toEqual(['coins']);
    expect(queryKeys.coins.lists()).toEqual(['coins', 'list']);
    expect(queryKeys.coins.list({ category: 'defi' })).toEqual(['coins', 'list', { category: 'defi' }]);
    expect(queryKeys.coins.list()).toEqual(queryKeys.coins.lists());
    expect(queryKeys.coins.watchlist()).toEqual(['coins', 'watchlist']);
    expect(queryKeys.coins.detail('btc')).toEqual(['coins', 'detail', 'btc']);
    expect(queryKeys.coins.chart('eth', '24h')).toEqual(['coins', 'detail', 'eth', 'chart', '24h']);
    expect(queryKeys.coins.holdings('ada')).toEqual(['coins', 'detail', 'ada', 'holdings']);
    expect(queryKeys.coins.price('avax')).toEqual(['coins', 'detail', 'avax', 'price']);
  });

  it('builds algorithm and backtest keys with detail paths', () => {
    expect(queryKeys.algorithms.performance('abc')).toEqual(['algorithms', 'detail', 'abc', 'performance']);
    expect(queryKeys.algorithms.performanceHistory('abc', '7d')).toEqual([
      'algorithms',
      'detail',
      'abc',
      'performance-history',
      '7d'
    ]);
    expect(queryKeys.algorithms.strategies()).toEqual(['algorithms', 'strategies']);

    expect(queryKeys.backtests.signals('b1')).toEqual(['backtests', 'detail', 'b1', 'signals']);
    expect(queryKeys.backtests.trades('b1')).toEqual(['backtests', 'detail', 'b1', 'trades']);
    expect(queryKeys.backtests.lists()).toEqual(['backtests', 'list']);
    expect(queryKeys.backtests.datasets()).toEqual(['backtests', 'datasets']);
  });

  it('builds trading and balances keys with optional parameters', () => {
    expect(queryKeys.trading.tickerPairs()).toEqual(['trading', 'ticker-pair', 'all']);
    expect(queryKeys.trading.tickerPairs('binance')).toEqual(['trading', 'ticker-pair', 'binance']);
    expect(queryKeys.trading.orderBook('BTC/USDT')).toEqual(['trading', 'orderBook', 'BTC/USDT']);
    expect(queryKeys.trading.orders()).toEqual(['trading', 'orders']);
    expect(queryKeys.trading.activeOrders()).toEqual(['trading', 'orders', 'active']);
    expect(queryKeys.trading.orderHistory()).toEqual(['trading', 'orders', 'history']);
    expect(queryKeys.trading.balances()).toEqual(['trading', 'balances']);
    expect(queryKeys.trading.ticker('SOL/USD')).toEqual(['trading', 'ticker', 'SOL/USD']);
    expect(queryKeys.trading.estimate()).toEqual(['trading', 'estimate']);

    expect(queryKeys.balances.current()).toEqual(['balances', 'current']);
    expect(queryKeys.balances.current('kraken')).toEqual(['balances', 'exchange', 'kraken']);
    expect(queryKeys.balances.withHistory('30d')).toEqual(['balances', 'history', '30d']);
    expect(queryKeys.balances.withHistory('30d', 'kraken')).toEqual(['balances', 'history', '30d', 'kraken']);
    expect(queryKeys.balances.accountHistory(7)).toEqual(['balances', 'accountHistory', '7']);
    expect(queryKeys.balances.assets()).toEqual(['balances', 'assets']);
  });

  it('builds auth/profile and auxiliary domain keys', () => {
    expect(queryKeys.auth.user()).toEqual(['auth', 'user']);
    expect(queryKeys.auth.token()).toEqual(['auth', 'token']);
    expect(queryKeys.profile.detail()).toEqual(['profile', 'detail']);
    expect(queryKeys.profile.exchangeKeys()).toEqual(['profile', 'exchange-keys']);
    expect(queryKeys.prices.byIds('1,2')).toEqual(['prices', 'byIds', '1,2']);
    expect(queryKeys.exchanges.supported()).toEqual(['exchanges', 'list', 'supported']);
    expect(queryKeys.exchanges.detail('id1')).toEqual(['exchanges', 'detail', 'id1']);
    expect(queryKeys.exchanges.sync()).toEqual(['exchanges', 'sync']);
    expect(queryKeys.categories.detail('c1')).toEqual(['categories', 'detail', 'c1']);
    expect(queryKeys.categories.lists()).toEqual(['categories', 'list']);
    expect(queryKeys.risks.detail('r1')).toEqual(['risks', 'detail', 'r1']);
    expect(queryKeys.risks.lists()).toEqual(['risks', 'list']);
    expect(queryKeys.transactions.open()).toEqual(['transactions', 'open']);
    expect(queryKeys.transactions.detail('t1')).toEqual(['transactions', 'detail', 't1']);
    expect(queryKeys.comparisonReports.detail('cr1')).toEqual(['comparison-reports', 'detail', 'cr1']);
  });
});
