export interface Coin {
  id: string;
  slug: string;
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  genesis?: Date;
  marketRank?: number;
  totalSupply?: number;
  totalVolume?: number;
  circulatingSupply?: number;
  maxSupply?: number;
  geckoRank?: number;
  developerScore?: number;
  communityScore?: number;
  liquidityScore?: number;
  publicInterestScore?: number;
  sentimentUp?: number;
  sentimentDown?: number;
  ath?: number;
  athChange?: number;
  athDate?: Date;
  atl?: number;
  atlChange?: number;
  atlDate?: Date;
  currentPrice?: number;
  marketCap?: number;
  priceChange24h?: number;
  priceChangePercentage24h?: number;
  priceChangePercentage7d?: number;
  priceChangePercentage14d?: number;
  priceChangePercentage30d?: number;
  priceChangePercentage60d?: number;
  priceChangePercentage200d?: number;
  priceChangePercentage1y?: number;
  marketCapChange24h?: number;
  marketCapChangePercentage24h?: number;
  geckoLastUpdatedAt?: Date;
  createdAt?: Date;
  updatedAt: Date;
}

/**
 * External resource links for a cryptocurrency
 */
export interface CoinLinksDto {
  homepage: string[];
  blockchainSite: string[];
  officialForumUrl: string[];
  subredditUrl?: string;
  repositoryUrl: string[];
}

/**
 * Time period for price history charts
 */
export type TimePeriod = '24h' | '7d' | '30d' | '1y';

/**
 * Single price data point with timestamp
 */
export interface PriceDataPoint {
  timestamp: number; // Unix timestamp in milliseconds
  price: number; // USD price
}

/**
 * Market chart response with historical price data
 */
export interface MarketChartResponseDto {
  coinSlug: string;
  period: TimePeriod;
  prices: PriceDataPoint[];
  timestamps: number[]; // Unix timestamps (milliseconds)
  generatedAt: Date;
}

/**
 * Per-exchange holding breakdown
 */
export interface ExchangeHoldingDto {
  exchangeName: string;
  amount: number;
  lastSynced: Date;
}

/**
 * User's holdings for a specific cryptocurrency
 */
export interface UserHoldingsDto {
  coinSymbol: string;
  totalAmount: number; // Total holdings across all exchanges
  averageBuyPrice: number; // Weighted average purchase price
  currentValue: number; // totalAmount * currentPrice
  profitLoss: number; // currentValue - (totalAmount * averageBuyPrice)
  profitLossPercent: number; // (profitLoss / invested) * 100
  exchanges: ExchangeHoldingDto[];
}

/**
 * Comprehensive coin detail response with market data and optional user holdings
 */
export interface CoinDetailResponseDto {
  // Basic Info
  id: string;
  slug: string;
  name: string;
  symbol: string;
  imageUrl: string;

  // Current Market Data
  currentPrice: number;
  priceChange24h: number;
  priceChange24hPercent: number;

  // Market Statistics
  marketCap: number;
  marketCapRank?: number;
  volume24h: number;
  circulatingSupply: number;
  totalSupply?: number;
  maxSupply?: number;

  // Metadata
  description: string;
  links: CoinLinksDto;

  // User-specific (authenticated only)
  userHoldings?: UserHoldingsDto;

  // Timestamps
  lastUpdated: Date;
  metadataLastUpdated?: Date;
}

export interface CreateCoinDto {
  name: string;
  symbol: string;
  slug: string;
  image?: string;
}

export interface UpdateCoinDto {
  id: string;
  name?: string;
  symbol?: string;
  slug?: string;
  image?: string;
}
