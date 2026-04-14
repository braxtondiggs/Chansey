import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { Cache } from 'cache-manager';

import {
  NOTIFICATION_EVENTS,
  TradeExecutedNotification
} from '../notification/interfaces/notification-events.interface';

const PORTFOLIO_CACHE_PREFIXES = [
  'portfolio:summary',
  'portfolio:positions',
  'portfolio:allocation',
  'portfolio:performance',
  'portfolio:perf-by-strategy'
] as const;

@Injectable()
export class PortfolioCacheListener {
  private readonly logger = new Logger(PortfolioCacheListener.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  @OnEvent(NOTIFICATION_EVENTS.TRADE_EXECUTED, { async: true })
  async handleTradeExecuted(payload: TradeExecutedNotification): Promise<void> {
    try {
      const keys = PORTFOLIO_CACHE_PREFIXES.map((prefix) => `${prefix}:${payload.userId}`);
      await Promise.all(keys.map((key) => this.cacheManager.del(key)));
      this.logger.debug(`Invalidated ${keys.length} portfolio cache keys for user ${payload.userId}`);
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to invalidate portfolio cache for user ${payload.userId}: ${error instanceof Error ? error.message : error}`
      );
    }
  }
}
