import { IsNotEmpty, IsString } from 'class-validator';

export class CreatePortfolioDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsString()
  coin: string;
}
