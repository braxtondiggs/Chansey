import { IsDate, IsDateString, IsDecimal, IsNumber, IsString, IsUrl } from 'class-validator';

export class UpdateCoinDto {
  @IsString()
  slug?: string;

  @IsString()
  name?: string;

  @IsString()
  symbol?: string;

  @IsString()
  description?: string;

  @IsUrl()
  image?: string;

  @IsDateString()
  genesis?: Date;

  @IsNumber()
  totalSupply?: number;

  @IsNumber()
  totalVolume?: number;

  @IsNumber()
  circulatingSupply?: number;

  @IsNumber()
  maxSupply?: number;

  @IsNumber()
  marketRank?: number;

  @IsNumber()
  marketCap?: number;

  @IsNumber()
  geckoRank?: number;

  @IsDecimal()
  developerScore?: number;

  @IsDecimal()
  communityScore?: number;

  @IsDecimal()
  liquidityScore?: number;

  @IsDecimal()
  publicInterestScore?: number;

  @IsDecimal()
  sentimentUp?: number;

  @IsDecimal()
  sentimentDown?: number;

  @IsDecimal()
  ath?: number;

  @IsDecimal()
  atl?: number;

  @IsDateString()
  athDate?: Date;

  @IsDateString()
  atlDate?: Date;

  @IsDecimal()
  athChange?: number;

  @IsDecimal()
  atlChange?: number;

  @IsDecimal()
  priceChange24h?: number;

  @IsDecimal()
  priceChangePercentage24h?: number;

  @IsDecimal()
  priceChangePercentage7d?: number;

  @IsDecimal()
  priceChangePercentage14d?: number;

  @IsDecimal()
  priceChangePercentage30d?: number;

  @IsDecimal()
  priceChangePercentage60d?: number;

  @IsDecimal()
  priceChangePercentage200d?: number;

  @IsDecimal()
  priceChangePercentage1y?: number;

  @IsDecimal()
  currentPrice?: number;

  @IsDecimal()
  marketCapChange24h?: number;

  @IsDecimal()
  marketCapChangePercentage24h?: number;

  @IsDate()
  geckoLastUpdatedAt?: Date;
}
