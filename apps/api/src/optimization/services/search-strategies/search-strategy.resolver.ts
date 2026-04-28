import { Injectable } from '@nestjs/common';

import { AdaptiveSearchStrategy } from './adaptive-search.strategy';
import { GridSearchStrategy } from './grid-search.strategy';
import { RandomSearchStrategy } from './random-search.strategy';
import { SearchMethod, SearchStrategy } from './search-strategy.interface';

@Injectable()
export class SearchStrategyResolver {
  constructor(
    private readonly grid: GridSearchStrategy,
    private readonly random: RandomSearchStrategy,
    private readonly adaptive: AdaptiveSearchStrategy
  ) {}

  resolve(method: SearchMethod): SearchStrategy {
    switch (method) {
      case 'grid_search':
        return this.grid;
      case 'random_search':
        return this.random;
      case 'adaptive_search':
        return this.adaptive;
      default:
        throw new Error(`Unknown search method: ${String(method)}`);
    }
  }
}
