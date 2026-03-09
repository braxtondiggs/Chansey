import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';
import * as webpush from 'web-push';

import { toErrorInfo } from '../../shared/error.util';
import { PushSubscription } from '../entities/push-subscription.entity';
import { NotificationJobData } from '../interfaces/notification-events.interface';

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private readonly vapidPublicKey: string;
  private readonly vapidConfigured: boolean;

  constructor(
    @InjectRepository(PushSubscription)
    private readonly pushSubRepo: Repository<PushSubscription>,
    private readonly config: ConfigService
  ) {
    this.vapidPublicKey = this.config.get<string>('VAPID_PUBLIC_KEY', '');
    const vapidPrivateKey = this.config.get<string>('VAPID_PRIVATE_KEY', '');
    const vapidEmail = this.config.get<string>('VAPID_EMAIL', 'mailto:admin@cymbit.com');

    if (this.vapidPublicKey && vapidPrivateKey) {
      webpush.setVapidDetails(vapidEmail, this.vapidPublicKey, vapidPrivateKey);
      this.vapidConfigured = true;
      this.logger.log('VAPID configured for web push');
    } else {
      this.vapidConfigured = false;
      this.logger.warn('VAPID keys not configured — push notifications disabled');
    }
  }

  async send(job: NotificationJobData): Promise<boolean> {
    if (!this.vapidConfigured) {
      this.logger.debug('Push skipped — VAPID not configured');
      return false;
    }

    const subscriptions = await this.pushSubRepo.find({
      where: { userId: job.userId }
    });

    if (subscriptions.length === 0) {
      this.logger.debug(`No push subscriptions for user ${job.userId}`);
      return false;
    }

    const pushPayload = JSON.stringify({
      title: job.title,
      body: job.body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      data: {
        eventType: job.eventType,
        url: '/app'
      }
    });

    let anySuccess = false;

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          },
          pushPayload
        );
        anySuccess = true;
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        // 410 Gone = subscription expired
        if (err.message.includes('410') || err.message.includes('Gone')) {
          this.logger.debug(`Removing expired push subscription ${sub.id}`);
          await this.pushSubRepo.remove(sub);
        } else {
          this.logger.warn(`Push failed for subscription ${sub.id}: ${err.message}`);
        }
      }
    }

    return anySuccess;
  }

  async subscribe(
    userId: string,
    endpoint: string,
    p256dh: string,
    auth: string,
    userAgent?: string
  ): Promise<PushSubscription> {
    await this.pushSubRepo.upsert(
      { userId, endpoint, p256dh, auth, userAgent: userAgent ?? null },
      { conflictPaths: ['endpoint'], skipUpdateIfNoValuesChanged: true }
    );
    return this.pushSubRepo.findOneByOrFail({ endpoint });
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.pushSubRepo.delete({ userId, endpoint });
  }

  getVapidPublicKey(): string {
    return this.vapidPublicKey;
  }
}
