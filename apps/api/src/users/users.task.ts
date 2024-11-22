import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { UsersService } from './users.service';

@Injectable()
export class UsersTaskService {
  private readonly logger = new Logger(UsersTaskService.name);
  constructor(private readonly user: UsersService) {}

  @Cron(CronExpression.EVERY_WEEK)
  async updateUserPortfolio() {
    try {
      const users = await this.user.findAll();

      for (const user of users) {
        if (user.risk) {
          await this.user.updatePortfolioByUserRisk(user);
          this.logger.debug(`Updated portfolio for user: ${user.id}`);
        }
      }
    } catch (error) {
      this.logger.error('Failed to update user portfolios:', error.stack);
    }
  }
}
