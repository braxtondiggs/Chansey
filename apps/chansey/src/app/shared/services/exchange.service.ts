import { Injectable } from '@angular/core';

import { Exchange } from '@chansey/api-interfaces';

import { exchangeKeys, useAuthQuery } from '@chansey-web/app/core/query';

@Injectable({
  providedIn: 'root'
})
export class ExchangeService {
  useSupportedExchanges() {
    return useAuthQuery<Exchange[]>(exchangeKeys.lists.supported, '/api/exchange?supported=true');
  }
}
