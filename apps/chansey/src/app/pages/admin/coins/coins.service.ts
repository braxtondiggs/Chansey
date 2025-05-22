import { Injectable } from '@angular/core';

import { coinKeys } from '@chansey-web/app/core/query/query.keys';
import { useAuthQuery, useAuthMutation } from '@chansey-web/app/core/query/query.utils';

export interface Coin {
  id: string;
  name: string;
  symbol: string;
  slug: string;
  logo: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCoinDto {
  name: string;
  symbol: string;
  slug: string;
  logo?: string;
}

export interface UpdateCoinDto {
  name?: string;
  symbol?: string;
  slug?: string;
  logo?: string;
}

@Injectable({
  providedIn: 'root'
})
export class CoinsService {
  private apiUrl = '/api/coin';

  useCoins() {
    return useAuthQuery<Coin[]>(coinKeys.lists.all, this.apiUrl);
  }

  useCoin() {
    return useAuthQuery<Coin, string>(
      (id: string) => coinKeys.detail(id),
      (id: string) => `${this.apiUrl}/${id}`
    );
  }

  useCreateCoin() {
    return useAuthMutation<Coin, CreateCoinDto>(this.apiUrl, 'POST', {
      invalidateQueries: [coinKeys.lists.all]
    });
  }

  useUpdateCoin() {
    return useAuthMutation<Coin, { id: string } & UpdateCoinDto>(
      (variables) => `${this.apiUrl}/${variables.id}`,
      'PATCH',
      {
        invalidateQueries: [coinKeys.lists.all]
      }
    );
  }

  useDeleteCoin() {
    return useAuthMutation<void, string>((id: string) => `${this.apiUrl}/${id}`, 'DELETE', {
      invalidateQueries: [coinKeys.lists.all]
    });
  }
}
