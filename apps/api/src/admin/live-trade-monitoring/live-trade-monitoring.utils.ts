import { Decimal } from 'decimal.js';

import { AlertThresholdsDto } from './dto/alerts.dto';
import { AlgorithmSortField, LiveTradeFiltersDto, OrderSortField } from './dto/filters.dto';
import { LiveSlippageStatsDto } from './dto/slippage-analysis.dto';

/** Maximum number of records to export to prevent DoS */
export const MAX_EXPORT_LIMIT = 10000;

/** Default alert thresholds */
export const DEFAULT_THRESHOLDS: AlertThresholdsDto = {
  sharpeRatioWarning: 25,
  sharpeRatioCritical: 50,
  winRateWarning: 10,
  winRateCritical: 20,
  maxDrawdownWarning: 25,
  maxDrawdownCritical: 50,
  totalReturnWarning: 20,
  totalReturnCritical: 40,
  slippageWarningBps: 30,
  slippageCriticalBps: 50
};

/** Whitelist mapping for safe sort column access (prevents SQL injection) */
export const ALGORITHM_SORT_COLUMN_MAP: Record<AlgorithmSortField, string> = {
  [AlgorithmSortField.NAME]: 'a.name',
  [AlgorithmSortField.ACTIVATED_AT]: 'aa.activatedAt',
  [AlgorithmSortField.TOTAL_ORDERS]: 'totalOrders',
  [AlgorithmSortField.ROI]: 'ap.roi',
  [AlgorithmSortField.WIN_RATE]: 'ap.winRate'
};

export const ORDER_SORT_COLUMN_MAP: Record<OrderSortField, string> = {
  [OrderSortField.CREATED_AT]: 'o.createdAt',
  [OrderSortField.TRANSACT_TIME]: 'o.transactTime',
  [OrderSortField.SYMBOL]: 'o.symbol',
  [OrderSortField.COST]: 'o.cost',
  [OrderSortField.ACTUAL_SLIPPAGE_BPS]: 'o.actualSlippageBps'
};

export interface DateRange {
  startDate?: Date;
  endDate?: Date;
}

/**
 * Builds a correlated subquery condition that selects the most recent
 * AlgorithmPerformance row per activation. No user input — safe to inline.
 */
export function latestPerformanceCondition(alias: string, innerAlias = 'ap2'): string {
  return `${alias}.calculatedAt = (SELECT MAX(${innerAlias}."calculatedAt") FROM algorithm_performances ${innerAlias} WHERE ${innerAlias}."algorithmActivationId" = ${alias}."algorithmActivationId")`;
}

export function getDateRange(filters: LiveTradeFiltersDto): DateRange {
  return {
    startDate: filters.startDate ? new Date(filters.startDate) : undefined,
    endDate: filters.endDate ? new Date(filters.endDate) : undefined
  };
}

/** Coerce a raw SQL value to a finite number, returning fallback for null/undefined/NaN. */
export function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/** Coerce a raw SQL value to a base-10 integer, returning fallback for null/undefined/NaN. */
export function toInt(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const num = parseInt(String(value), 10);
  return Number.isFinite(num) ? num : fallback;
}

/** Map a raw slippage-stats SQL row to a LiveSlippageStatsDto. */
export function mapSlippageStatsRow(row: Record<string, unknown> | null | undefined): LiveSlippageStatsDto {
  return {
    avgBps: toNumber(row?.avgBps),
    medianBps: toNumber(row?.medianBps),
    minBps: toNumber(row?.minBps),
    maxBps: toNumber(row?.maxBps),
    p95Bps: toNumber(row?.p95Bps),
    stdDevBps: toNumber(row?.stdDevBps),
    orderCount: toInt(row?.orderCount)
  };
}

/**
 * Calculate the percentage deviation of a live value from a backtest value.
 * When the backtest value is zero, returns ±100 (or 0 when both are zero).
 */
export function calculateDeviationPercent(liveValue: number, backtestValue: number): number {
  if (backtestValue === 0) {
    if (liveValue === 0) return 0;
    return liveValue > 0 ? 100 : -100;
  }
  return new Decimal(liveValue).minus(backtestValue).dividedBy(Math.abs(backtestValue)).times(100).toNumber();
}

/**
 * Convert an array of plain objects to a CSV buffer. Escapes commas, quotes,
 * and newlines, and prefixes formula-injection characters with a single quote.
 */
export function convertToCsv(data: object[]): Buffer {
  if (data.length === 0) {
    return Buffer.from('');
  }

  const headers = Object.keys(data[0]);
  const csvRows: string[] = [headers.join(',')];

  for (const row of data) {
    const values = headers.map((h) => {
      const val = (row as Record<string, unknown>)[h];
      if (val === null || val === undefined) return '';
      let str = String(val);
      const isFormulaInjection = typeof val === 'string' && /^[=+\-@\t\r]/.test(str);
      if (isFormulaInjection) {
        str = `'${str}`;
      }
      if (/[,"\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    csvRows.push(values.join(','));
  }

  return Buffer.from(csvRows.join('\n'), 'utf-8');
}
