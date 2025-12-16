import { Injectable } from '@angular/core';

import { queryKeys, useAuthQuery, FREQUENT_POLICY } from '@chansey/shared';

// Asset interface to match response from API
export interface UserAsset {
  symbol: string; // Asset symbol (e.g., BTC, ETH)
  name: string; // Full name (e.g., Bitcoin, Ethereum)
  quantity: number; // How much of this asset the user owns
  price: number; // Current price of the asset
  usdValue: number; // Total USD value (quantity * price)
  image?: string; // Optional image URL for the asset
  priceChangePercentage24h?: number; // 24h price change percentage
  slug?: string; // Coin slug for routing to detail page
}

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
