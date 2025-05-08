import { Injectable } from '@angular/core';

import { exchangeKeys } from '@chansey-web/app/core/query/query.keys';
import { useAuthQuery, useAuthMutation } from '@chansey-web/app/core/query/query.utils';

export interface Exchange {
  id: string;
  name: string;
  url: string;
  supported: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExchangeDto {
  name: string;
  url: string;
  supported: boolean;
  slug: string;
}

export interface UpdateExchangeDto {
  id: string;
  name?: string;
  url?: string;
  supported?: boolean;
}

export interface SyncResponse {
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class ExchangesService {
  private apiUrl = '/api/exchange';

  useExchanges() {
    return useAuthQuery<Exchange[]>(exchangeKeys.lists.all, this.apiUrl);
  }

  useExchange() {
    return useAuthQuery<Exchange, string>(
      (id: string) => exchangeKeys.detail(id),
      (id: string) => `${this.apiUrl}/${id}`
    );
  }

  useCreateExchange() {
    return useAuthMutation<Exchange, CreateExchangeDto>(this.apiUrl, 'POST', {
      invalidateQueries: [exchangeKeys.lists.all]
    });
  }

  useUpdateExchange() {
    return useAuthMutation<Exchange, UpdateExchangeDto>((variables) => `${this.apiUrl}/${variables.id}`, 'PATCH', {
      invalidateQueries: [exchangeKeys.lists.all]
    });
  }

  useDeleteExchange() {
    return useAuthMutation<void, string>((id: string) => `${this.apiUrl}/${id}`, 'DELETE', {
      invalidateQueries: [exchangeKeys.lists.all]
    });
  }

  useSyncExchanges() {
    return useAuthMutation<SyncResponse, void>(`${this.apiUrl}/sync`, 'POST', {
      invalidateQueries: [exchangeKeys.lists.all]
    });
  }
}
