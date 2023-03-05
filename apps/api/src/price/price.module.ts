import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { Price } from './price.entity';
import { PriceService } from './price.service';

@Module({
  imports: [MikroOrmModule.forFeature({ entities: [Price] })],
  providers: [PriceService],
  exports: [PriceService]
})
export class PriceModule {}
