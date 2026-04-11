import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { EmailNotificationService } from './channels/email-notification.service';
import { PushNotificationService } from './channels/push-notification.service';
import { SmsNotificationService } from './channels/sms-notification.service';
import { Notification } from './entities/notification.entity';
import { NotificationJobData } from './interfaces/notification-events.interface';

import { FailSafeWorkerHost } from '../failed-jobs/fail-safe-worker-host';
import { FailedJobService } from '../failed-jobs/failed-job.service';
import { toErrorInfo } from '../shared/error.util';

@Processor('notification')
@Injectable()
export class NotificationProcessor extends FailSafeWorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly emailService: EmailNotificationService,
    private readonly pushService: PushNotificationService,
    private readonly smsService: SmsNotificationService,
    failedJobService: FailedJobService,
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>
  ) {
    super(failedJobService);
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const data = job.data;
    const startTime = Date.now();

    this.logger.log(`Processing notification job ${job.id}: ${data.eventType} for user ${data.userId}`);

    // Always persist in-app notification
    try {
      await this.notificationRepo.save(
        new Notification({
          userId: data.userId,
          eventType: data.eventType,
          title: data.title,
          body: data.body,
          severity: data.severity,
          metadata: data.payload,
          read: false,
          readAt: null
        })
      );
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to persist in-app notification: ${err.message}`, err.stack);
    }

    // Dispatch to each channel independently
    for (const channel of data.channels) {
      try {
        switch (channel) {
          case 'email':
            await this.emailService.send(data);
            break;
          case 'push':
            await this.pushService.send(data);
            break;
          case 'sms':
            await this.smsService.send(data);
            break;
        }
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        // One channel failure should not block others
        this.logger.error(`Channel ${channel} failed for job ${job.id}: ${err.message}`, err.stack);
      }
    }

    this.logger.log(`Notification job ${job.id} completed in ${Date.now() - startTime}ms`);
  }
}
