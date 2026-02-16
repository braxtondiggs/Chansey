import { PortfolioType } from './portfolio-type.enum';

import { Coin } from '../coin/coin.interface';

export interface CreatePortfolioDto {
  coinId: string;
  type: PortfolioType;
}

export interface PortfolioItem {
  id: string;
  coin: Coin;
  type: PortfolioType;
  createdAt?: Date;
  updatedAt?: Date;
}
