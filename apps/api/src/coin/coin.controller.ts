import { Controller, Get } from '@nestjs/common';

import { ICoin } from './coin.interface';
import { CoinService } from './coin.service';

@Controller('coin')
export class CoinController {
  constructor(private readonly coin: CoinService) { }

  @Get()
  async findAll(): Promise<ICoin> {
    return this.coin.findAll();
  }
}
