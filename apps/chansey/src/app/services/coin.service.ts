import { Injectable } from '@angular/core';

import { Coin } from '@chansey/api-interfaces';

import { coinKeys } from '@chansey-web/app/core/query/query.keys';
import { useAuthQuery } from '@chansey-web/app/core/query/query.utils';

@Injectable({
  providedIn: 'root'
})
export class CoinService {
  useCoins() {
    return useAuthQuery<Coin[]>(coinKeys.lists.all, '/api/coin');
  }
}
