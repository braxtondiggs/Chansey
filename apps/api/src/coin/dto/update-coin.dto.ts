import { IsDate, IsDateString, IsDecimal, IsNumber, IsString, IsUrl } from 'class-validator';

export class UpdateCoinDto {
  @IsString()
  slug?: string;

  @IsString()
  name?: string;

  @IsString()
  symbol?: string;

  @IsString()
  description?: string | null;

  @IsUrl()
  image?: string | null;

  @IsDateString()
  genesis?: Date | null;

  @IsNumber()
  totalSupply?: number | null;

  @IsNumber()
  totalVolume?: number | null;

  @IsNumber()
  circulatingSupply?: number | null;

  @IsNumber()
  maxSupply?: number | null;

  @IsNumber()
  marketRank?: number | null;

  @IsNumber()
  marketCap?: number | null;

  @IsNumber()
  geckoRank?: number | null;

  @IsDecimal()
  developerScore?: number | null;

  @IsDecimal()
  communityScore?: number | null;

  @IsDecimal()
  liquidityScore?: number | null;

  @IsDecimal()
  publicInterestScore?: number | null;

  @IsDecimal()
  sentimentUp?: number | null;

  @IsDecimal()
  sentimentDown?: number | null;

  @IsDecimal()
  ath?: number | null;

  @IsDecimal()
  atl?: number | null;

  @IsDateString()
  athDate?: Date | null;

  @IsDateString()
  atlDate?: Date | null;

  @IsDecimal()
  athChange?: number | null;

  @IsDecimal()
  atlChange?: number | null;

  @IsDecimal()
  priceChange24h?: number | null;

  @IsDecimal()
  priceChangePercentage24h?: number | null;

  @IsDecimal()
  priceChangePercentage7d?: number | null;

  @IsDecimal()
  priceChangePercentage14d?: number | null;

  @IsDecimal()
  priceChangePercentage30d?: number | null;

  @IsDecimal()
  priceChangePercentage60d?: number | null;

  @IsDecimal()
  priceChangePercentage200d?: number | null;

  @IsDecimal()
  priceChangePercentage1y?: number | null;

  @IsDecimal()
  currentPrice?: number | null;

  @IsDecimal()
  marketCapChange24h?: number | null;

  @IsDecimal()
  marketCapChangePercentage24h?: number | null;

  @IsDate()
  geckoLastUpdatedAt?: Date | null;
}
