import { Injectable, Signal } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { Algorithm, AlgorithmStrategy, CreateAlgorithmDto, UpdateAlgorithmDto } from '@chansey/api-interfaces';
import {
  queryKeys,
  useAuthQuery,
  useAuthMutation,
  authenticatedFetch,
  STANDARD_POLICY,
  STATIC_POLICY
} from '@chansey/shared';

/**
 * Service for managing algorithms via TanStack Query
 *
 * Uses centralized query keys and standardized caching policies.
 */
@Injectable({
  providedIn: 'root'
})
export class AlgorithmsService {
  private readonly apiUrl = '/api/algorithm';

  /**
   * Query all algorithms
   */
  useAlgorithms() {
    return useAuthQuery<Algorithm[]>(queryKeys.algorithms.lists(), this.apiUrl, {
      cachePolicy: STANDARD_POLICY
    });
  }

  /**
   * Query available algorithm strategies
   *
   * Uses STATIC policy since strategies rarely change
   */
  useStrategies() {
    return useAuthQuery<AlgorithmStrategy[]>(queryKeys.algorithms.strategies(), `${this.apiUrl}/strategies`, {
      cachePolicy: STATIC_POLICY
    });
  }

  /**
   * Query a single algorithm by ID (dynamic query)
   *
   * @param algorithmId - Signal containing the algorithm ID
   */
  useAlgorithm(algorithmId: Signal<string | null>) {
    return injectQuery(() => {
      const id = algorithmId();
      return {
        queryKey: queryKeys.algorithms.detail(id || ''),
        queryFn: () => authenticatedFetch<Algorithm>(`${this.apiUrl}/${id}`),
        ...STANDARD_POLICY,
        enabled: !!id
      };
    });
  }

  /**
   * Create a new algorithm
   */
  useCreateAlgorithm() {
    return useAuthMutation<Algorithm, CreateAlgorithmDto>(this.apiUrl, 'POST', {
      invalidateQueries: [queryKeys.algorithms.all]
    });
  }

  /**
   * Update an existing algorithm
   */
  useUpdateAlgorithm() {
    return useAuthMutation<Algorithm, UpdateAlgorithmDto>((variables) => `${this.apiUrl}/${variables.id}`, 'PATCH', {
      invalidateQueries: [queryKeys.algorithms.all]
    });
  }

  /**
   * Delete an algorithm
   */
  useDeleteAlgorithm() {
    return useAuthMutation<void, string>((id: string) => `${this.apiUrl}/${id}`, 'DELETE', {
      invalidateQueries: [queryKeys.algorithms.all]
    });
  }
}
