import { Injectable, Logger } from '@nestjs/common';

import { NotificationJobData } from '../interfaces/notification-events.interface';

/**
 * SMS Notification Service (stub)
 *
 * No-op implementation until an SMS provider is chosen (Twilio, AWS SNS, etc.)
 */
@Injectable()
export class SmsNotificationService {
  private readonly logger = new Logger(SmsNotificationService.name);

  async send(job: NotificationJobData): Promise<boolean> {
    this.logger.debug(`SMS notification skipped (no provider configured) for user ${job.userId}: ${job.title}`);
    return false;
  }
}
