import { forwardRef, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';

import * as ccxt from 'ccxt';
import { LessThan, Repository } from 'typeorm';

import {
  ExchangeKeyHealthHistoryResponseDto,
  ExchangeKeyHealthLogDto,
  ExchangeKeyHealthSummaryDto
} from './dto/exchange-key-health.dto';
import { ExchangeKeyHealthLog } from './exchange-key-health-log.entity';
import { ExchangeKey } from './exchange-key.entity';

import { EmailService } from '../../email/email.service';
import { toErrorInfo } from '../../shared/error.util';
import { User } from '../../users/users.entity';
import { UsersService } from '../../users/users.service';
import { ExchangeManagerService } from '../exchange-manager.service';

type ErrorCategory = 'authentication' | 'permission' | 'nonce' | 'exchange_down' | 'network' | 'rate_limit' | 'unknown';

const DEACTIVATION_ELIGIBLE_CATEGORIES = new Set<ErrorCategory>(['authentication', 'permission']);
const WARNING_THRESHOLD = 3;
const DEACTIVATION_THRESHOLD = 5;

@Injectable()
export class ExchangeKeyHealthService implements OnModuleInit {
  private readonly logger = new Logger(ExchangeKeyHealthService.name);
  private emailService!: EmailService;
  private usersService!: UsersService;

  constructor(
    @InjectRepository(ExchangeKey)
    private readonly exchangeKeyRepo: Repository<ExchangeKey>,
    @InjectRepository(ExchangeKeyHealthLog)
    private readonly healthLogRepo: Repository<ExchangeKeyHealthLog>,
    @Inject(forwardRef(() => ExchangeManagerService))
    private readonly exchangeManager: ExchangeManagerService,
    private readonly moduleRef: ModuleRef
  ) {}

  onModuleInit() {
    this.emailService = this.moduleRef.get(EmailService, { strict: false });
    this.usersService = this.moduleRef.get(UsersService, { strict: false });
  }

  classifyError(error: unknown): ErrorCategory {
    // PermissionDenied extends AuthenticationError in CCXT, so check it first
    if (error instanceof ccxt.PermissionDenied) return 'permission';
    if (error instanceof ccxt.AuthenticationError) return 'authentication';
    if (error instanceof ccxt.InvalidNonce) return 'nonce';
    if (error instanceof ccxt.ExchangeNotAvailable) return 'exchange_down';
    if (error instanceof ccxt.RateLimitExceeded) return 'rate_limit';
    if (error instanceof ccxt.NetworkError) return 'network';
    return 'unknown';
  }

  async checkKeyHealth(exchangeKey: ExchangeKey): Promise<void> {
    const startTime = Date.now();
    let status: string;
    let errorCategory: ErrorCategory | null = null;
    let errorMessage: string | null = null;

    try {
      const exchangeSlug = exchangeKey.exchange?.slug;
      if (!exchangeSlug) {
        this.logger.warn(`Exchange key ${exchangeKey.id} has no exchange slug, skipping`);
        return;
      }

      const user = await this.usersService.getById(exchangeKey.userId);
      if (!user) return;

      const client = await this.exchangeManager.getExchangeClient(exchangeSlug, user);
      await client.fetchBalance();

      status = 'healthy';
      exchangeKey.healthStatus = 'healthy';
      exchangeKey.consecutiveFailures = 0;
      exchangeKey.lastErrorCategory = null;
      exchangeKey.lastErrorMessage = null;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      errorCategory = this.classifyError(error);
      errorMessage = err.message;
      status = 'unhealthy';

      exchangeKey.lastErrorCategory = errorCategory;
      exchangeKey.lastErrorMessage = errorMessage;

      if (DEACTIVATION_ELIGIBLE_CATEGORIES.has(errorCategory)) {
        // Atomic increment to avoid race conditions with concurrent health checks
        const result = await this.exchangeKeyRepo
          .createQueryBuilder()
          .update(ExchangeKey)
          .set({ consecutiveFailures: () => '"consecutiveFailures" + 1' })
          .where({ id: exchangeKey.id })
          .returning('"consecutiveFailures"')
          .execute()
          .then((r) => r.raw[0]);

        const consecutiveFailures: number = result.consecutiveFailures;
        exchangeKey.consecutiveFailures = consecutiveFailures;

        const user = await this.usersService.getById(exchangeKey.userId);

        if (consecutiveFailures === DEACTIVATION_THRESHOLD) {
          exchangeKey.isActive = false;
          exchangeKey.deactivatedByHealthCheck = true;
          exchangeKey.healthStatus = 'deactivated';
          if (user) await this.notifyDeactivation(exchangeKey, user);
        } else if (consecutiveFailures === WARNING_THRESHOLD) {
          exchangeKey.healthStatus = 'warning';
          if (user) await this.notifyWarning(exchangeKey, user);
        } else if (consecutiveFailures > WARNING_THRESHOLD) {
          exchangeKey.healthStatus = 'warning';
        } else {
          exchangeKey.healthStatus = 'unhealthy';
        }
      } else {
        // Transient error — log but don't increment counter
        exchangeKey.healthStatus = exchangeKey.consecutiveFailures >= WARNING_THRESHOLD ? 'warning' : 'unhealthy';
      }
    }

    const responseTimeMs = Date.now() - startTime;
    exchangeKey.lastHealthCheckAt = new Date();

    await this.exchangeKeyRepo.save(exchangeKey);

    await this.healthLogRepo.save(
      this.healthLogRepo.create({
        exchangeKeyId: exchangeKey.id,
        status,
        errorCategory,
        errorMessage,
        responseTimeMs
      })
    );
  }

  async checkAllKeys(): Promise<{ total: number; healthy: number; unhealthy: number; deactivated: number }> {
    const keys = await this.exchangeKeyRepo.find({
      where: { isActive: true },
      relations: ['exchange']
    });

    let healthy = 0;
    let unhealthy = 0;
    let deactivated = 0;

    // Group keys by exchange to parallelize across exchanges
    const keysByExchange = new Map<string, ExchangeKey[]>();
    for (const key of keys) {
      const exchangeId = key.exchangeId ?? 'unknown';
      const group = keysByExchange.get(exchangeId) ?? [];
      group.push(key);
      keysByExchange.set(exchangeId, group);
    }

    const processExchangeGroup = async (exchangeKeys: ExchangeKey[]) => {
      const results = { healthy: 0, unhealthy: 0, deactivated: 0 };

      for (let i = 0; i < exchangeKeys.length; i++) {
        if (i > 0) {
          // 3s stagger between keys within the same exchange (same rate limit domain)
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }

        try {
          await this.checkKeyHealth(exchangeKeys[i]);

          if (exchangeKeys[i].healthStatus === 'healthy') results.healthy++;
          else if (exchangeKeys[i].healthStatus === 'deactivated') results.deactivated++;
          else results.unhealthy++;
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.error(`Health check failed for key ${exchangeKeys[i].id}: ${err.message}`, err.stack);
          results.unhealthy++;
        }
      }

      return results;
    };

    // Run exchanges in parallel, stagger within each exchange
    const groupResults = await Promise.all(
      Array.from(keysByExchange.values()).map((group) => processExchangeGroup(group))
    );

    for (const result of groupResults) {
      healthy += result.healthy;
      unhealthy += result.unhealthy;
      deactivated += result.deactivated;
    }

    return { total: keys.length, healthy, unhealthy, deactivated };
  }

  async getHealthSummary(userId: string): Promise<ExchangeKeyHealthSummaryDto[]> {
    const keys = await this.exchangeKeyRepo.find({
      where: { userId },
      relations: ['exchange']
    });

    return keys.map((key) => ({
      id: key.id,
      exchangeId: key.exchangeId,
      exchange: key.exchange
        ? { id: key.exchange.id, name: key.exchange.name, slug: key.exchange.slug }
        : { id: key.exchangeId, name: '', slug: '' },
      healthStatus: key.healthStatus,
      lastHealthCheckAt: key.lastHealthCheckAt,
      consecutiveFailures: key.consecutiveFailures,
      lastErrorCategory: key.lastErrorCategory,
      lastErrorMessage: key.lastErrorMessage,
      deactivatedByHealthCheck: key.deactivatedByHealthCheck,
      isActive: key.isActive
    }));
  }

  async getHealthHistory(
    exchangeKeyId: string,
    userId: string,
    page: number,
    limit: number
  ): Promise<ExchangeKeyHealthHistoryResponseDto> {
    // Verify ownership
    const key = await this.exchangeKeyRepo.findOne({
      where: { id: exchangeKeyId, userId }
    });

    if (!key) {
      throw new NotFoundException('Exchange key not found');
    }

    const [logs, total] = await this.healthLogRepo.findAndCount({
      where: { exchangeKeyId },
      order: { checkedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit
    });

    const data: ExchangeKeyHealthLogDto[] = logs.map((log) => ({
      id: log.id,
      status: log.status,
      errorCategory: log.errorCategory,
      errorMessage: log.errorMessage,
      responseTimeMs: log.responseTimeMs,
      checkedAt: log.checkedAt
    }));

    return { data, total, page, limit };
  }

  async cleanupOldLogs(retentionDays = 90): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const result = await this.healthLogRepo.delete({
      checkedAt: LessThan(cutoff)
    });

    const deleted = result.affected ?? 0;
    this.logger.log(`Cleaned up ${deleted} health log entries older than ${retentionDays} days`);
    return deleted;
  }

  private async notifyWarning(exchangeKey: ExchangeKey, user: User): Promise<void> {
    try {
      if (!user?.email) return;

      const exchangeName = exchangeKey.exchange?.name ?? 'Unknown Exchange';
      await this.emailService.sendExchangeKeyWarningEmail(
        user.email,
        user.given_name ?? 'there',
        exchangeName,
        exchangeKey.consecutiveFailures
      );
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to send warning email for key ${exchangeKey.id}: ${err.message}`);
    }
  }

  private async notifyDeactivation(exchangeKey: ExchangeKey, user: User): Promise<void> {
    try {
      if (!user?.email) return;

      const exchangeName = exchangeKey.exchange?.name ?? 'Unknown Exchange';
      await this.emailService.sendExchangeKeyDeactivatedEmail(user.email, user.given_name ?? 'there', exchangeName);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to send deactivation email for key ${exchangeKey.id}: ${err.message}`);
    }
  }
}
