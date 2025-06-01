import { Injectable } from '@angular/core';

import { QueryKey } from '@tanstack/angular-query-experimental';

import { createQueryKeys, useAuthQuery } from '../../core/query/query.utils';

// Asset interface to match response from API
export interface UserAsset {
  symbol: string; // Asset symbol (e.g., BTC, ETH)
  name: string; // Full name (e.g., Bitcoin, Ethereum)
  quantity: number; // How much of this asset the user owns
  price: number; // Current price of the asset
  usdValue: number; // Total USD value (quantity * price)
  image?: string; // Optional image URL for the asset
  priceChangePercentage24h?: number; // 24h price change percentage
}

// Create query keys for user assets
export const assetKeys = createQueryKeys<{
  all: QueryKey;
}>('user-assets');

@Injectable({
  providedIn: 'root'
})
export class UserAssetsService {
  /**
   * Get user assets with detailed information
   * @returns Query result with user assets data
   */
  useUserAssets() {
    return useAuthQuery<UserAsset[]>(assetKeys.all, 'api/balance/assets', {
      refetchOnWindowFocus: true
    });
  }
}
