import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { NotificationEventType } from '@chansey/api-interfaces';

import {
  DailyLossLimitNotification,
  DailySummaryNotification,
  DriftAlertNotification,
  NOTIFICATION_EVENTS,
  RiskBreachNotification,
  StrategyDemotedNotification,
  StrategyDeployedNotification,
  TradeErrorNotification,
  TradeExecutedNotification,
  TradingHaltedNotification
} from './interfaces/notification-events.interface';
import { NotificationService } from './notification.service';

import { toErrorInfo } from '../shared/error.util';

@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(private readonly notificationService: NotificationService) {}

  @OnEvent(NOTIFICATION_EVENTS.TRADE_EXECUTED, { async: true })
  async handleTradeExecuted(payload: TradeExecutedNotification): Promise<void> {
    try {
      await this.notificationService.send(
        payload.userId,
        NotificationEventType.TRADE_EXECUTED,
        `Trade Executed: ${payload.action} ${payload.symbol}`,
        `${payload.action} ${payload.quantity} ${payload.symbol} at $${payload.price.toFixed(2)} on ${payload.exchangeName}`,
        'info',
        payload
      );
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to handle trade executed notification: ${err.message}`, err.stack);
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.TRADE_ERROR, { async: true })
  async handleTradeError(payload: TradeErrorNotification): Promise<void> {
    try {
      await this.notificationService.send(
        payload.userId,
        NotificationEventType.TRADE_ERROR,
        `Trade Failed: ${payload.action} ${payload.symbol}`,
        `Failed to execute ${payload.action} on ${payload.symbol}: ${payload.errorMessage}`,
        'high',
        payload
      );
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to handle trade error notification: ${err.message}`, err.stack);
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.RISK_BREACH, { async: true })
  async handleRiskBreach(payload: RiskBreachNotification): Promise<void> {
    try {
      await this.notificationService.send(
        payload.userId,
        NotificationEventType.RISK_BREACH,
        `Risk Breach: ${payload.metric}`,
        `${payload.metric} exceeded threshold (${payload.threshold}) with value ${payload.actual}${payload.strategyName ? ` on ${payload.strategyName}` : ''}`,
        'critical',
        payload
      );
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to handle risk breach notification: ${err.message}`, err.stack);
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.DRIFT_ALERT, { async: true })
  async handleDriftAlert(payload: DriftAlertNotification): Promise<void> {
    try {
      await this.notificationService.send(
        payload.userId,
        NotificationEventType.DRIFT_ALERT,
        `Drift Alert: ${payload.strategyName}`,
        payload.message,
        payload.severity,
        payload
      );
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to handle drift alert notification: ${err.message}`, err.stack);
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.TRADING_HALTED, { async: true })
  async handleTradingHalted(payload: TradingHaltedNotification): Promise<void> {
    try {
      await this.notificationService.send(
        payload.userId,
        NotificationEventType.TRADING_HALTED,
        'Trading Halted',
        `Trading has been halted: ${payload.reason}${payload.strategyName ? ` (${payload.strategyName})` : ''}`,
        'critical',
        payload
      );
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to handle trading halted notification: ${err.message}`, err.stack);
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.DAILY_SUMMARY, { async: true })
  async handleDailySummary(payload: DailySummaryNotification): Promise<void> {
    try {
      const pnlText = payload.pnl !== undefined ? ` | P&L: $${payload.pnl.toFixed(2)}` : '';
      await this.notificationService.send(
        payload.userId,
        NotificationEventType.DAILY_SUMMARY,
        'Daily Trading Summary',
        `Today: ${payload.totalTrades} trades, ${payload.totalAlerts} alerts (${payload.criticalAlerts} critical)${pnlText}`,
        'info',
        payload
      );
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to handle daily summary notification: ${err.message}`, err.stack);
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.STRATEGY_DEPLOYED, { async: true })
  async handleStrategyDeployed(payload: StrategyDeployedNotification): Promise<void> {
    try {
      await this.notificationService.send(
        payload.userId,
        NotificationEventType.STRATEGY_DEPLOYED,
        `Strategy Deployed: ${payload.strategyName}`,
        `Your strategy "${payload.strategyName}" has been deployed to live trading.`,
        'info',
        payload
      );
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to handle strategy deployed notification: ${err.message}`, err.stack);
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.STRATEGY_DEMOTED, { async: true })
  async handleStrategyDemoted(payload: StrategyDemotedNotification): Promise<void> {
    try {
      await this.notificationService.send(
        payload.userId,
        NotificationEventType.STRATEGY_DEMOTED,
        `Strategy Demoted: ${payload.strategyName}`,
        `Strategy "${payload.strategyName}" has been demoted: ${payload.reason}`,
        'high',
        payload
      );
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to handle strategy demoted notification: ${err.message}`, err.stack);
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.DAILY_LOSS_LIMIT, { async: true })
  async handleDailyLossLimit(payload: DailyLossLimitNotification): Promise<void> {
    try {
      await this.notificationService.send(
        payload.userId,
        NotificationEventType.DAILY_LOSS_LIMIT,
        'Daily Loss Limit Reached',
        `Trading paused: daily loss of $${payload.currentLoss.toFixed(2)} exceeds ${payload.limitPercent}% limit`,
        'critical',
        payload
      );
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to handle daily loss limit notification: ${err.message}`, err.stack);
    }
  }
}
