import { Injectable } from '@angular/core';

import { UserAsset } from '@chansey/api-interfaces';
import { FREQUENT_POLICY, queryKeys, useAuthQuery } from '@chansey/shared';

/**
 * Service for user assets data via TanStack Query
 *
 * Uses centralized query keys and standardized caching policies.
 */
@Injectable({
  providedIn: 'root'
})
export class UserAssetsService {
  /**
   * Query user assets with detailed information
   *
   * Uses FREQUENT policy since asset values change with prices
   */
  useUserAssets() {
    return useAuthQuery<UserAsset[]>(queryKeys.balances.assets(), 'api/balance/assets', {
      cachePolicy: FREQUENT_POLICY,
      refetchOnWindowFocus: true
    });
  }
}
