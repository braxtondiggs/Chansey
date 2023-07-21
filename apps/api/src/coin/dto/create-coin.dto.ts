import { IsNotEmpty, IsString } from 'class-validator';
export class CreateCoinDto {
  @IsString()
  @IsNotEmpty()
  slug: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  symbol: string;
}
