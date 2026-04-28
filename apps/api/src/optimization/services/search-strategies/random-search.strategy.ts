import { Injectable } from '@nestjs/common';

import { SearchStrategy, SearchStrategyOptions } from './search-strategy.interface';

import { ParameterCombination, ParameterSpace } from '../../interfaces';
import { GridSearchService } from '../grid-search.service';

@Injectable()
export class RandomSearchStrategy implements SearchStrategy {
  readonly method = 'random_search' as const;
  readonly isStatic = true;

  constructor(private readonly gridSearchService: GridSearchService) {}

  generateInitialCombinations(
    space: ParameterSpace,
    targetCount: number | undefined,
    options?: SearchStrategyOptions
  ): ParameterCombination[] {
    return this.gridSearchService.generateRandomCombinations(
      space,
      targetCount ?? 100,
      options?.reachabilityFilter,
      options?.random
    );
  }

  generateNextBatch(): ParameterCombination[] {
    return [];
  }
}
