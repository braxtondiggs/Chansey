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
  circulatingSupply?: number;

  @IsNumber()
  maxSupply?: number;

  @IsNumber()
  marketRank?: number;

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

  @IsDate()
  geckoLastUpdatedAt: Date;
}
