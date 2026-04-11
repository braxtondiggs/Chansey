import { type NotificationEventType, type NotificationSeverity } from '@chansey/api-interfaces';

/**
 * Event name constants for EventEmitter2
 */
export const NOTIFICATION_EVENTS = {
  TRADE_EXECUTED: 'notification.trade-executed',
  TRADE_ERROR: 'notification.trade-error',
  RISK_BREACH: 'notification.risk-breach',
  DRIFT_ALERT: 'notification.drift-alert',
  TRADING_HALTED: 'notification.trading-halted',
  DAILY_SUMMARY: 'notification.daily-summary',
  STRATEGY_DEPLOYED: 'notification.strategy-deployed',
  STRATEGY_DEMOTED: 'notification.strategy-demoted',
  DAILY_LOSS_LIMIT: 'notification.daily-loss-limit',
  REGIME_STALE: 'notification.regime-stale'
} as const;

/**
 * Base notification payload — all events include userId
 */
interface BaseNotificationPayload {
  userId: string;
}

export interface TradeExecutedNotification extends BaseNotificationPayload {
  action: 'BUY' | 'SELL';
  symbol: string;
  quantity: number;
  price: number;
  exchangeName: string;
  orderId?: string;
}

export interface TradeErrorNotification extends BaseNotificationPayload {
  symbol: string;
  action: 'BUY' | 'SELL';
  errorMessage: string;
}

export interface RiskBreachNotification extends BaseNotificationPayload {
  metric: string;
  threshold: number;
  actual: number;
  strategyName?: string;
  deploymentId?: string;
}

export interface DriftAlertNotification extends BaseNotificationPayload {
  driftType: string;
  severity: NotificationSeverity;
  message: string;
  strategyName: string;
  deploymentId: string;
  deviationPercent: number;
}

export interface TradingHaltedNotification extends BaseNotificationPayload {
  reason: string;
  strategyName?: string;
}

export interface DailySummaryNotification extends BaseNotificationPayload {
  totalTrades: number;
  totalAlerts: number;
  criticalAlerts: number;
  pnl?: number;
}

export interface StrategyDeployedNotification extends BaseNotificationPayload {
  strategyName: string;
  deploymentId: string;
}

export interface StrategyDemotedNotification extends BaseNotificationPayload {
  strategyName: string;
  reason: string;
  deploymentId: string;
}

export interface DailyLossLimitNotification extends BaseNotificationPayload {
  currentLoss: number;
  limitPercent: number;
}

/** Broadcast to all admins — no single userId, so intentionally does not extend BaseNotificationPayload */
export interface RegimeStaleNotification {
  lastRefreshAt: Date | null;
  consecutiveFailures: number;
  cachedRegime: string;
}

export type NotificationPayload =
  | TradeExecutedNotification
  | TradeErrorNotification
  | RiskBreachNotification
  | DriftAlertNotification
  | TradingHaltedNotification
  | DailySummaryNotification
  | StrategyDeployedNotification
  | StrategyDemotedNotification
  | DailyLossLimitNotification
  | RegimeStaleNotification;

/**
 * BullMQ job data for the notification queue
 */
export interface NotificationJobData {
  userId: string;
  userEmail: string;
  userName: string;
  eventType: NotificationEventType;
  title: string;
  body: string;
  severity: NotificationSeverity;
  channels: ('email' | 'push' | 'sms')[];
  payload: Record<string, unknown>;
}
