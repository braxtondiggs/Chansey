import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Price } from './price.entity';
import { PriceService } from './price.service';

@Module({
  imports: [TypeOrmModule.forFeature([Price])],
  providers: [PriceService],
  exports: [PriceService]
})
export class PriceModule {}
