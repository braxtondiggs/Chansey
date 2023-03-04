import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { CoinController } from './coin.controller';
import { Coin } from './coin.entity';
import { CoinService } from './coin.service';

@Module({
  imports: [MikroOrmModule.forFeature({ entities: [Coin] })],
  providers: [CoinService],
  controllers: [CoinController],
  exports: [CoinService]
})
export class CoinModule {}
