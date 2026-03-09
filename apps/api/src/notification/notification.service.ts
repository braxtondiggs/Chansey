import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { Repository } from 'typeorm';

import { NotificationEventType, NotificationPreferences, NotificationSeverity } from '@chansey/api-interfaces';

import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { NotificationJobData, NotificationPayload } from './interfaces/notification-events.interface';
import { NOTIFICATION_REDIS } from './notification-redis.provider';

import { toErrorInfo } from '../shared/error.util';
import { User } from '../users/users.entity';

/** Rate limit window in seconds (5 minutes) */
const RATE_LIMIT_TTL = 300;

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectQueue('notification')
    private readonly notificationQueue: Queue,
    @Inject(NOTIFICATION_REDIS)
    private readonly redis: Redis,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>
  ) {}

  /**
   * Get a user's notification preferences.
   */
  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const user = await this.userRepository.findOneByOrFail({ id: userId });
    return user.notificationPreferences;
  }

  /**
   * Send a notification to a user after checking preferences, rate limits, and quiet hours.
   */
  async send(
    userId: string,
    eventType: NotificationEventType,
    title: string,
    body: string,
    severity: NotificationSeverity,
    payload: NotificationPayload
  ): Promise<void> {
    try {
      const user = await this.userRepository.findOneBy({ id: userId });
      if (!user) {
        this.logger.warn(`Cannot send notification - user ${userId} not found`);
        return;
      }

      const prefs = user.notificationPreferences;

      // Check if this event type is enabled
      if (!prefs.events[eventType]) {
        this.logger.debug(`Notification ${eventType} disabled for user ${userId}`);
        return;
      }

      // Check rate limiting (skip for critical severity)
      if (severity !== 'critical' && (await this.isRateLimited(userId, eventType))) {
        this.logger.debug(`Notification ${eventType} rate-limited for user ${userId}`);
        return;
      }

      // Determine active channels (skip quiet hours for critical)
      const channels: ('email' | 'push' | 'sms')[] = [];
      const inQuietHours = severity !== 'critical' && this.isQuietHours(prefs);

      if (prefs.channels.email && !inQuietHours) channels.push('email');
      if (prefs.channels.push) channels.push('push'); // Push always allowed (user controls via OS)
      if (prefs.channels.sms && !inQuietHours) channels.push('sms');

      const jobData: NotificationJobData = {
        userId,
        userEmail: user.email,
        userName: user.given_name || 'Trader',
        eventType,
        title,
        body,
        severity,
        channels,
        payload: payload as unknown as Record<string, unknown>
      };

      await this.notificationQueue.add('send-notification', jobData, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500
      });

      this.logger.debug(`Notification ${eventType} enqueued for user ${userId} via [${channels.join(', ')}]`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to enqueue notification for user ${userId}: ${err.message}`, err.stack);
    }
  }

  /**
   * Check if the notification is rate-limited using Redis SET NX EX
   */
  async isRateLimited(userId: string, eventType: NotificationEventType): Promise<boolean> {
    const key = `notif:rl:${userId}:${eventType}`;
    const result = await this.redis.set(key, '1', 'EX', RATE_LIMIT_TTL, 'NX');
    // result is 'OK' if key was set (not rate limited), null if key already existed (rate limited)
    return result === null;
  }

  /**
   * Check if current UTC hour falls within the user's quiet hours
   */
  isQuietHours(prefs: NotificationPreferences): boolean {
    if (!prefs.quietHours.enabled) return false;

    const currentHour = new Date().getUTCHours();
    const { startHourUtc, endHourUtc } = prefs.quietHours;

    if (startHourUtc <= endHourUtc) {
      // Simple range, e.g. 9-17
      return currentHour >= startHourUtc && currentHour < endHourUtc;
    } else {
      // Wraps midnight, e.g. 22-7
      return currentHour >= startHourUtc || currentHour < endHourUtc;
    }
  }

  /**
   * Update a user's notification preferences (partial merge)
   */
  async updatePreferences(userId: string, partial: UpdatePreferencesDto): Promise<NotificationPreferences> {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    const merged: NotificationPreferences = {
      channels: { ...user.notificationPreferences.channels, ...partial.channels },
      events: { ...user.notificationPreferences.events, ...partial.events },
      quietHours: { ...user.notificationPreferences.quietHours, ...partial.quietHours }
    };

    await this.userRepository.update(userId, { notificationPreferences: merged });

    return merged;
  }
}
