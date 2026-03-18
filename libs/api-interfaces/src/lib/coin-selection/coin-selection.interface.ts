import { CoinSelectionType } from './coin-selection-type.enum';

import { Coin } from '../coin/coin.interface';

export interface CreateCoinSelectionDto {
  coinId: string;
  type: CoinSelectionType;
}

export interface CoinSelectionItem {
  id: string;
  coin: Coin;
  type: CoinSelectionType;
  createdAt?: Date;
  updatedAt?: Date;
}
