import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ExchangeKeyController } from './exchange-key.controller';
import { ExchangeKey } from './exchange-key.entity';
import { ExchangeKeyService } from './exchange-key.service';

import { User } from '../../users/users.entity';
import { ExchangeModule } from '../exchange.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ExchangeKey, User]),
    forwardRef(() => ExchangeModule),
    BullModule.registerQueue({ name: 'order-queue' })
  ],
  controllers: [ExchangeKeyController],
  providers: [ExchangeKeyService],
  exports: [ExchangeKeyService]
})
export class ExchangeKeyModule {}
