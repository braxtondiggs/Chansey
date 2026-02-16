import { Coin } from '../coin/coin.interface';

export interface AssetBalanceDto {
  asset: string;
  free: string;
  locked: string;
  usdValue?: number;
}

export interface ExchangeBalanceDto {
  id: string;
  name: string;
  slug: string;
  balances: AssetBalanceDto[];
  totalUsdValue: number;
  timestamp: Date;
}

export interface HistoricalBalanceDto extends ExchangeBalanceDto {
  period: string;
}

export interface BalanceResponseDto {
  current: ExchangeBalanceDto[];
  historical?: HistoricalBalanceDto[];
  totalUsdValue: number;
}

export interface AccountValueDataPoint {
  datetime: string;
  value: number;
}

export interface AccountValueHistoryDto {
  history: AccountValueDataPoint[];
  currentValue: number;
  changePercentage: number;
}

export interface UserAsset {
  id?: string;
  symbol: string;
  name: string;
  quantity: number;
  price: number;
  usdValue: number;
  image?: string;
  priceChangePercentage24h?: number;
  slug?: string;
}

export interface Balance {
  coin: Coin;
  available: number;
  locked: number;
  total: number;
}
