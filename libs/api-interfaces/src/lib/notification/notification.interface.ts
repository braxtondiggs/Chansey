/**
 * Notification system shared interfaces
 */

export enum NotificationEventType {
  TRADE_EXECUTED = 'trade_executed',
  TRADE_ERROR = 'trade_error',
  RISK_BREACH = 'risk_breach',
  DRIFT_ALERT = 'drift_alert',
  TRADING_HALTED = 'trading_halted',
  DAILY_SUMMARY = 'daily_summary',
  STRATEGY_DEPLOYED = 'strategy_deployed',
  STRATEGY_DEMOTED = 'strategy_demoted',
  DAILY_LOSS_LIMIT = 'daily_loss_limit'
}

export type NotificationSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface NotificationChannelPreferences {
  email: boolean;
  push: boolean;
  sms: boolean;
}

export interface NotificationEventPreferences {
  [NotificationEventType.TRADE_EXECUTED]: boolean;
  [NotificationEventType.TRADE_ERROR]: boolean;
  [NotificationEventType.RISK_BREACH]: boolean;
  [NotificationEventType.DRIFT_ALERT]: boolean;
  [NotificationEventType.TRADING_HALTED]: boolean;
  [NotificationEventType.DAILY_SUMMARY]: boolean;
  [NotificationEventType.STRATEGY_DEPLOYED]: boolean;
  [NotificationEventType.STRATEGY_DEMOTED]: boolean;
  [NotificationEventType.DAILY_LOSS_LIMIT]: boolean;
}

export interface QuietHoursConfig {
  enabled: boolean;
  startHourUtc: number; // 0-23
  endHourUtc: number; // 0-23
}

export interface NotificationPreferences {
  channels: NotificationChannelPreferences;
  events: NotificationEventPreferences;
  quietHours: QuietHoursConfig;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  channels: {
    email: true,
    push: false,
    sms: false
  },
  events: {
    [NotificationEventType.TRADE_EXECUTED]: true,
    [NotificationEventType.TRADE_ERROR]: true,
    [NotificationEventType.RISK_BREACH]: true,
    [NotificationEventType.DRIFT_ALERT]: true,
    [NotificationEventType.TRADING_HALTED]: true,
    [NotificationEventType.DAILY_SUMMARY]: true,
    [NotificationEventType.STRATEGY_DEPLOYED]: true,
    [NotificationEventType.STRATEGY_DEMOTED]: true,
    [NotificationEventType.DAILY_LOSS_LIMIT]: true
  },
  quietHours: {
    enabled: false,
    startHourUtc: 22,
    endHourUtc: 7
  }
};

/**
 * Notification DTO for the in-app notification feed
 */
export interface NotificationDto {
  id: string;
  eventType: NotificationEventType;
  title: string;
  body: string;
  severity: NotificationSeverity;
  read: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface NotificationFeedResponse {
  data: NotificationDto[];
  total: number;
  unreadCount: number;
}
