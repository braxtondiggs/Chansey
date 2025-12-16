import { Injectable, Signal } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { Risk, CreateRisk, UpdateRisk } from '@chansey/api-interfaces';
import {
  queryKeys,
  useAuthQuery,
  useAuthMutation,
  authenticatedFetch,
  STANDARD_POLICY,
  STATIC_POLICY
} from '@chansey/shared';

/**
 * Service for managing risks in admin panel via TanStack Query
 *
 * Uses centralized query keys and standardized caching policies.
 * Risk levels are relatively static data, so uses STATIC policy for lists.
 */
@Injectable({
  providedIn: 'root'
})
export class RisksService {
  private readonly apiUrl = '/api/risk';

  /**
   * Query all risks
   *
   * Uses STATIC policy since risk levels rarely change
   */
  useRisks() {
    return useAuthQuery<Risk[]>(queryKeys.risks.lists(), this.apiUrl, {
      cachePolicy: STATIC_POLICY
    });
  }

  /**
   * Query a single risk by ID (dynamic query)
   *
   * @param riskId - Signal containing the risk ID
   */
  useRisk(riskId: Signal<string | null>) {
    return injectQuery(() => {
      const id = riskId();
      return {
        queryKey: queryKeys.risks.detail(id || ''),
        queryFn: () => authenticatedFetch<Risk>(`${this.apiUrl}/${id}`),
        ...STANDARD_POLICY,
        enabled: !!id
      };
    });
  }

  /**
   * Create a new risk level
   */
  useCreateRisk() {
    return useAuthMutation<Risk, CreateRisk>(this.apiUrl, 'POST', {
      invalidateQueries: [queryKeys.risks.all]
    });
  }

  /**
   * Update an existing risk level
   */
  useUpdateRisk() {
    return useAuthMutation<Risk, UpdateRisk>((variables) => `${this.apiUrl}/${variables.id}`, 'PATCH', {
      invalidateQueries: [queryKeys.risks.all]
    });
  }

  /**
   * Delete a risk level
   */
  useDeleteRisk() {
    return useAuthMutation<void, string>((id: string) => `${this.apiUrl}/${id}`, 'DELETE', {
      invalidateQueries: [queryKeys.risks.all]
    });
  }
}
