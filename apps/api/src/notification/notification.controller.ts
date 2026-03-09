import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { PushNotificationService } from './channels/push-notification.service';
import { PushSubscriptionDto, PushUnsubscribeDto } from './dto/push-subscription.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { Notification } from './entities/notification.entity';
import { NotificationService } from './notification.service';

import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';

interface AuthenticatedRequest {
  user: { id: string };
}

@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly pushService: PushNotificationService,
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>
  ) {}

  // ─── Preferences ───────────────────────────────────────────

  @Get('preferences')
  @UseGuards(JwtAuthenticationGuard)
  async getPreferences(@Req() req: AuthenticatedRequest) {
    return this.notificationService.getPreferences(req.user.id);
  }

  @Patch('preferences')
  @UseGuards(JwtAuthenticationGuard)
  async updatePreferences(@Req() req: AuthenticatedRequest, @Body() dto: UpdatePreferencesDto) {
    return this.notificationService.updatePreferences(req.user.id, dto);
  }

  // ─── Push Subscriptions ────────────────────────────────────

  @Get('push/vapid-key')
  @UseGuards(JwtAuthenticationGuard)
  getVapidKey() {
    return { key: this.pushService.getVapidPublicKey() };
  }

  @Post('push/subscribe')
  @UseGuards(JwtAuthenticationGuard)
  async subscribePush(@Req() req: AuthenticatedRequest, @Body() dto: PushSubscriptionDto) {
    const sub = await this.pushService.subscribe(req.user.id, dto.endpoint, dto.p256dh, dto.auth, dto.userAgent);
    return { id: sub.id };
  }

  @Delete('push/unsubscribe')
  @UseGuards(JwtAuthenticationGuard)
  async unsubscribePush(@Req() req: AuthenticatedRequest, @Body() dto: PushUnsubscribeDto) {
    await this.pushService.unsubscribe(req.user.id, dto.endpoint);
    return { ok: true };
  }

  // ─── Notification Feed ─────────────────────────────────────

  @Get()
  @UseGuards(JwtAuthenticationGuard)
  async getNotifications(
    @Req() req: AuthenticatedRequest,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    const take = Math.min(Math.max(1, parseInt(limit || '20', 10) || 20), 50);
    const skip = Math.max(0, parseInt(offset || '0', 10) || 0);

    const qb = this.notificationRepo
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId: req.user.id })
      .orderBy('n.createdAt', 'DESC')
      .take(take)
      .skip(skip);

    if (unreadOnly === 'true') {
      qb.andWhere('n.read = :read', { read: false });
    }

    const [data, total] = await qb.getManyAndCount();

    const unreadCount = await this.notificationRepo.count({
      where: { userId: req.user.id, read: false }
    });

    return { data, total, unreadCount };
  }

  @Get('unread-count')
  @UseGuards(JwtAuthenticationGuard)
  async getUnreadCount(@Req() req: AuthenticatedRequest) {
    const count = await this.notificationRepo.count({
      where: { userId: req.user.id, read: false }
    });
    return { count };
  }

  @Patch(':id/read')
  @UseGuards(JwtAuthenticationGuard)
  async markRead(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    await this.notificationRepo.update({ id, userId: req.user.id }, { read: true, readAt: new Date() });
    return { ok: true };
  }

  @Patch('read-all')
  @UseGuards(JwtAuthenticationGuard)
  async markAllRead(@Req() req: AuthenticatedRequest) {
    await this.notificationRepo.update({ userId: req.user.id, read: false }, { read: true, readAt: new Date() });
    return { ok: true };
  }
}
