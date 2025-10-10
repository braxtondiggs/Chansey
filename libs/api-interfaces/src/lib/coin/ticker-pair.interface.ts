import { TickerPairStatus } from './ticker-pair-status.enum';

import { Coin } from '../coin/coin.interface';
import { Exchange } from '../exchange/exchange.interface';

export interface TickerPair {
  id: string;
  volume: number;
  tradeUrl?: string;
  spreadPercentage?: number;
  lastTraded: Date;
  fetchAt: Date;
  symbol: string;
  baseAsset?: Coin;
  quoteAsset?: Coin;
  coin?: Coin;
  target?: Coin;
  createdAt: Date;
  updatedAt: Date;
  exchange?: Exchange;
  status: TickerPairStatus;
  isSpotTradingAllowed: boolean;
  isMarginTradingAllowed: boolean;
  currentPrice?: number;
}
