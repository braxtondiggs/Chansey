import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { OrderService } from './order.service';

import { ExchangeKeyService } from '../exchange/exchange-key/exchange-key.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class OrderTask {
  private readonly logger = new Logger(OrderTask.name);

  constructor(
    private readonly orderService: OrderService,
    private readonly exchangeKeyService: ExchangeKeyService,
    private readonly usersService: UsersService
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async syncAllUsersOrders() {
    try {
      this.logger.log('Starting scheduled order synchronization for all users');
      const users = await this.usersService.getUsersWithActiveExchangeKeys();

      for (const user of users) {
        try {
          await this.orderService.syncOrdersForUser(user);
        } catch (error) {
          this.logger.error(`Failed to sync orders for user ${user.id}: ${error.message}`, error.stack);
          // Continue with next user even if one fails
        }
      }

      this.logger.log(`Completed order synchronization for ${users.length} users`);
    } catch (error) {
      this.logger.error(`Order synchronization failed: ${error.message}`, error.stack);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupStaleOrders() {
    try {
      this.logger.log('Starting cleanup of stale orders');
      const deletedCount = await this.orderService.cleanupStaleOrders();
      this.logger.log(`Completed cleanup: ${deletedCount} stale orders removed`);
    } catch (error) {
      this.logger.error(`Order cleanup failed: ${error.message}`, error.stack);
    }
  }
}
