import { BullModule } from '@nestjs/bullmq';
import { Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import Redis from 'ioredis';

import { EmailNotificationService } from './channels/email-notification.service';
import { PushNotificationService } from './channels/push-notification.service';
import { SmsNotificationService } from './channels/sms-notification.service';
import { Notification } from './entities/notification.entity';
import { PushSubscription } from './entities/push-subscription.entity';
import { PipelineNotificationListener } from './listeners/pipeline-notification.listener';
import { NOTIFICATION_REDIS, notificationRedisProvider } from './notification-redis.provider';
import { NotificationController } from './notification.controller';
import { NotificationListener } from './notification.listener';
import { NotificationProcessor } from './notification.processor';
import { NotificationService } from './notification.service';

import { EmailModule } from '../email/email.module';
import { Pipeline } from '../pipeline/entities/pipeline.entity';
import { toErrorInfo } from '../shared/error.util';
import { User } from '../users/users.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, PushSubscription, Notification, Pipeline]),
    BullModule.registerQueue({ name: 'notification' }),
    EmailModule
  ],
  controllers: [NotificationController],
  providers: [
    notificationRedisProvider,
    NotificationService,
    NotificationProcessor,
    NotificationListener,
    PipelineNotificationListener,
    EmailNotificationService,
    PushNotificationService,
    SmsNotificationService
  ],
  exports: [NotificationService]
})
export class NotificationModule implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationModule.name);

  constructor(@Inject(NOTIFICATION_REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
      this.logger.log('Notification Redis connection closed');
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Error closing notification Redis connection: ${err.message}`);
      this.redis.disconnect();
    }
  }
}
