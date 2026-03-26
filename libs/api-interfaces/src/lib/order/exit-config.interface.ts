/**
 * Frontend exit configuration types — Subset of backend ExitConfigDto for manual order UI (excludes ATR-based types).
 * Used for the Exit Strategy panel in the order form.
 */

export enum StopLossType {
  FIXED = 'fixed',
  PERCENTAGE = 'percentage'
}

export enum TakeProfitType {
  FIXED = 'fixed',
  PERCENTAGE = 'percentage',
  RISK_REWARD = 'risk_reward'
}

export enum ExitTrailingType {
  AMOUNT = 'amount',
  PERCENTAGE = 'percentage'
}

export enum TrailingActivationType {
  IMMEDIATE = 'immediate',
  PRICE = 'price',
  PERCENTAGE = 'percentage'
}

export interface ExitConfigRequest {
  enableStopLoss: boolean;
  stopLossType: StopLossType;
  stopLossValue: number;

  enableTakeProfit: boolean;
  takeProfitType: TakeProfitType;
  takeProfitValue: number;

  enableTrailingStop: boolean;
  trailingType: ExitTrailingType;
  trailingValue: number;
  trailingActivation: TrailingActivationType;
  trailingActivationValue?: number;

  useOco: boolean;
}

export const DEFAULT_EXIT_CONFIG: ExitConfigRequest = {
  enableStopLoss: false,
  stopLossType: StopLossType.PERCENTAGE,
  stopLossValue: 2.0,

  enableTakeProfit: false,
  takeProfitType: TakeProfitType.PERCENTAGE,
  takeProfitValue: 5.0,

  enableTrailingStop: false,
  trailingType: ExitTrailingType.PERCENTAGE,
  trailingValue: 1.0,
  trailingActivation: TrailingActivationType.IMMEDIATE,

  useOco: true
};
