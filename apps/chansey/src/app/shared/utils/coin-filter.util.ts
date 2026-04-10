import { type Coin } from '@chansey/api-interfaces';

export function filterCoinSuggestions(coins: Coin[], query: string, excludeSlugs: Set<string>, limit = 10): Coin[] {
  const q = query.toLowerCase();
  return coins
    .filter(
      (c) => !excludeSlugs.has(c.slug) && (c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q))
    )
    .slice(0, limit);
}
