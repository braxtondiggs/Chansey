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
}>('coins');

// Define list queries
coinKeys.lists = {
  all: [...coinKeys.all, 'list'],
  byCategory: (categoryId) => [...coinKeys.all, 'list', 'category', categoryId],
  watchlist: [...coinKeys.all, 'list', 'watchlist']
};

// Define detail query
coinKeys.detail = (id) => [...coinKeys.all, 'detail', id];

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
 * User profile query keys
 */
export const profileKeys = createQueryKeys<{
  all: QueryKey;
  detail: QueryKey;
}>('profile');

// Define detail query
profileKeys.detail = [...profileKeys.all, 'detail'];
