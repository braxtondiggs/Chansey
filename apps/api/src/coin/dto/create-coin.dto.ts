import { IsDateString, IsDecimal, IsNotEmpty, IsNumber, IsString, IsUrl } from 'class-validator';
export class CreateCoinDto {
  @IsString()
  @IsNotEmpty()
  slug: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  symbol: string;

  @IsString()
  description?: string;

  @IsUrl()
  image?: string;

  @IsDateString()
  genesis?: Date;

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
  sentiment_up?: number;

  @IsDecimal()
  sentiment_down?: number;
}
