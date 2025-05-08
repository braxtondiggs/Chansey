import { Injectable } from '@angular/core';

import { Exchange } from '@chansey/api-interfaces';

import { exchangeKeys } from '@chansey-web/app/core/query/query.keys';
import { useAuthQuery } from '@chansey-web/app/core/query/query.utils';

@Injectable({
  providedIn: 'root'
})
export class ExchangeService {
  useSupportedExchanges() {
    return useAuthQuery<Exchange[]>(exchangeKeys.lists.supported, '/api/exchange?supported=true');
  }
}
