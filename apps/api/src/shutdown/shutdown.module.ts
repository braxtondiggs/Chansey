import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QUEUE_NAMES } from './queue-names.constant';
import { ShutdownService } from './shutdown.service';

/**
 * Module that provides graceful shutdown capabilities for BullMQ queues.
 * Registers all queues and the ShutdownService which implements OnApplicationShutdown.
 */
@Module({
  imports: [BullModule.registerQueue(...QUEUE_NAMES.map((name) => ({ name })))],
  providers: [ShutdownService]
})
export class ShutdownModule {}
