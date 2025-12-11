import { QueryKey } from '@tanstack/angular-query-experimental';

import { createQueryKeys } from './query.utils';

/**
 * Exchange query keys
 */
export const exchangeKeys = createQueryKeys<{
  all: QueryKey;
  sync: QueryKey;
  lists: {
    all: QueryKey;
    supported: QueryKey;
  };
  detail: (id: string) => QueryKey;
}>('exchanges');

// Define list queries
exchangeKeys.lists = {
  all: [...exchangeKeys.all, 'list'],
  supported: [...exchangeKeys.all, 'list', 'supported']
};

// Define detail query
exchangeKeys.detail = (id) => [...exchangeKeys.all, 'detail', id];
exchangeKeys.sync = [...exchangeKeys.all, 'sync'];

/**
 * Category query keys
 */
export const categoryKeys = createQueryKeys<{
  all: QueryKey;
  lists: {
    all: QueryKey;
  };
  detail: (id: string) => QueryKey;
}>('categories');

// Define list queries
categoryKeys.lists = {
  all: [...categoryKeys.all, 'list']
};

// Define detail query
categoryKeys.detail = (id) => [...categoryKeys.all, 'detail', id];

/**
 * Coin query keys
 */
export const coinKeys = createQueryKeys<{
  all: QueryKey;
  lists: {
    all: QueryKey;
    byCategory: (categoryId: string) => QueryKey;
    watchlist: QueryKey;
  };
  detail: (id: string) => QueryKey;
  price: {
    byCoinId: (coinId: string) => QueryKey;
  };
}>('coins');

// Define list queries
coinKeys.lists = {
  all: [...coinKeys.all, 'list'],
  byCategory: (categoryId) => [...coinKeys.all, 'list', 'category', categoryId],
  watchlist: [...coinKeys.all, 'list', 'watchlist']
};

// Define detail query
coinKeys.detail = (id) => [...coinKeys.all, 'detail', id];

// Define price queries
coinKeys.price = {
  byCoinId: (coinId) => [...coinKeys.all, 'price', coinId]
};

/**
 * Risk query keys
 */
export const riskKeys = createQueryKeys<{
  all: QueryKey;
  lists: {
    all: QueryKey;
  };
  detail: (id: string) => QueryKey;
}>('risks');

// Define list queries
riskKeys.lists = {
  all: [...riskKeys.all, 'list']
};

// Define detail query
riskKeys.detail = (id) => [...riskKeys.all, 'detail', id];

/**
 * Algorithm query keys
 */
export const algorithmKeys = createQueryKeys<{
  all: QueryKey;
  lists: {
    all: QueryKey;
  };
  strategies: QueryKey;
  detail: (id: string) => QueryKey;
}>('algorithms');

// Define list queries
algorithmKeys.lists = {
  all: [...algorithmKeys.all, 'list']
};

// Define strategies query
algorithmKeys.strategies = [...algorithmKeys.all, 'strategies'];

// Define detail query
algorithmKeys.detail = (id) => [...algorithmKeys.all, 'detail', id];

/**
 * User profile query keys
 */
export const profileKeys = createQueryKeys<{
  all: QueryKey;
  detail: QueryKey;
}>('profile');

// Define detail query
profileKeys.detail = [...profileKeys.all, 'detail'];

/**
 * Backtesting query keys
 */
export const backtestKeys = createQueryKeys<{
  all: QueryKey;
  detail: (id: string) => QueryKey;
  signals: (id: string) => QueryKey;
  trades: (id: string) => QueryKey;
  datasets: QueryKey;
}>('backtests');

backtestKeys.detail = (id) => [...backtestKeys.all, 'detail', id];
backtestKeys.signals = (id) => [...backtestKeys.detail(id), 'signals'];
backtestKeys.trades = (id) => [...backtestKeys.detail(id), 'trades'];
backtestKeys.datasets = [...backtestKeys.all, 'datasets'];

export const comparisonKeys = createQueryKeys<{
  all: QueryKey;
  detail: (id: string) => QueryKey;
}>('comparison-reports');

comparisonKeys.detail = (id) => [...comparisonKeys.all, 'detail', id];
