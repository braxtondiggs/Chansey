import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ExchangeKeyHealthLog } from './exchange-key-health-log.entity';
import { ExchangeKeyHealthService } from './exchange-key-health.service';
import { ExchangeKeyController } from './exchange-key.controller';
import { ExchangeKey } from './exchange-key.entity';
import { ExchangeKeyService } from './exchange-key.service';
import { ExchangeKeyHealthTask } from './tasks/exchange-key-health.task';

import { User } from '../../users/users.entity';
import { ExchangeModule } from '../exchange.module';
import { EXCHANGE_KEY_SERVICE } from '../interfaces';

@Module({
  imports: [
    TypeOrmModule.forFeature([ExchangeKey, ExchangeKeyHealthLog, User]),
    forwardRef(() => ExchangeModule),
    BullModule.registerQueue({ name: 'order-queue' }),
    BullModule.registerQueue({ name: 'exchange-health-queue' })
  ],
  controllers: [ExchangeKeyController],
  providers: [
    ExchangeKeyService,
    ExchangeKeyHealthService,
    ExchangeKeyHealthTask,
    {
      provide: EXCHANGE_KEY_SERVICE,
      useExisting: ExchangeKeyService
    }
  ],
  exports: [ExchangeKeyService, ExchangeKeyHealthService, EXCHANGE_KEY_SERVICE]
})
export class ExchangeKeyModule {}
