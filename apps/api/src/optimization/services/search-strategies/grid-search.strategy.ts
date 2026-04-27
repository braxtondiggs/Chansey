import { Injectable } from '@nestjs/common';

import { SearchStrategy, SearchStrategyOptions } from './search-strategy.interface';

import { ParameterCombination, ParameterSpace } from '../../interfaces';
import { GridSearchService } from '../grid-search.service';

@Injectable()
export class GridSearchStrategy implements SearchStrategy {
  readonly method = 'grid_search' as const;
  readonly isStatic = true;

  constructor(private readonly gridSearchService: GridSearchService) {}

  generateInitialCombinations(
    space: ParameterSpace,
    targetCount: number | undefined,
    options?: SearchStrategyOptions
  ): ParameterCombination[] {
    return this.gridSearchService.generateCombinations(
      space,
      targetCount,
      options?.reachabilityFilter,
      options?.random
    );
  }

  generateNextBatch(): ParameterCombination[] {
    // Grid search enumerates everything up front; no incremental generation needed.
    return [];
  }
}
