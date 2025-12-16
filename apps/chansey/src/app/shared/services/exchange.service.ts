import { Injectable } from '@angular/core';

import { Exchange } from '@chansey/api-interfaces';
import { queryKeys, useAuthQuery, STATIC_POLICY } from '@chansey/shared';

/**
 * Service for exchange data via TanStack Query
 *
 * Uses centralized query keys and standardized caching policies.
 */
@Injectable({
  providedIn: 'root'
})
export class ExchangeService {
  /**
   * Query supported exchanges
   *
   * Uses STATIC policy since supported exchanges rarely change
   */
  useSupportedExchanges() {
    return useAuthQuery<Exchange[]>(queryKeys.exchanges.supported(), '/api/exchange?supported=true', {
      cachePolicy: STATIC_POLICY
    });
  }
}
