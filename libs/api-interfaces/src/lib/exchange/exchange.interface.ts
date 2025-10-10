import { TickerPair } from '../coin/ticker-pair.interface';

export interface Exchange {
  id: string;
  slug: string;
  name: string;
  description?: string;
  image?: string;
  country?: string;
  yearEstablished?: number;
  trustScore?: number;
  trustScoreRank?: number;
  tradeVolume24HBtc?: number;
  tradeVolume24HNormalized?: number;
  centralized?: boolean;
  url?: string;
  twitter?: string;
  facebook?: string;
  reddit?: string;
  telegram?: string;
  slack?: string;
  otherUrl1?: string;
  otherUrl2?: string;
  supported: boolean;
  isScraped: boolean;
  createdAt: Date;
  updatedAt: Date;
  tickers?: TickerPair[];
  tickerPairsCount?: number;
}

export interface ExchangeKey {
  id: string;
  exchangeId: string;
  isActive: boolean;
  name: string;
  slug: string;
}
