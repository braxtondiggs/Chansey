import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { UsersService } from './users.service';

import { HealthCheckHelper } from '../utils/health-check.helper';

@Injectable()
export class UsersTaskService {
  private readonly logger = new Logger(UsersTaskService.name);
  constructor(
    private readonly user: UsersService,
    private readonly healthCheck: HealthCheckHelper
  ) {}

  @Cron(CronExpression.EVERY_WEEK)
  async updateUserPortfolio() {
    const hc_uuid = '387993ec-ee93-4ea5-9bb8-0aca231c53d7';
    try {
      this.logger.log('Starting User Portfolio Update');
      await this.healthCheck.ping(hc_uuid, 'start');

      const users = await this.user.findAll();

      for (const user of users) {
        if (user.risk) {
          await this.user.updatePortfolioByUserRisk(user);
          this.logger.debug(`Updated portfolio for user: ${user.id}`);
        }
      }
      await this.healthCheck.ping(hc_uuid);
    } catch (error) {
      this.logger.error('Failed to update user portfolios:', error.stack);
      await this.healthCheck.ping(hc_uuid, 'fail');
    }
  }
}
