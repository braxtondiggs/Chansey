import { registerAs } from '@nestjs/config';

/**
 * Slippage Limits Configuration
 *
 * Controls pre-execution slippage checks to prevent trades with
 * excessive estimated slippage from executing.
 */
export interface SlippageLimitsConfig {
  /**
   * Maximum allowed estimated slippage in basis points.
   * Orders exceeding this threshold will be rejected.
   * Default: 100 bps (1%)
   */
  maxSlippageBps: number;

  /**
   * Warning threshold in basis points.
   * Orders exceeding this threshold will log a warning but still execute.
   * Default: 50 bps (0.5%)
   */
  warnSlippageBps: number;

  /**
   * Whether to abort orders if actual post-execution slippage exceeds max.
   * When enabled, orders that slip too much during execution will be flagged.
   * Default: false (only log, don't cancel)
   */
  abortOnHighSlippage: boolean;

  /**
   * Whether pre-execution slippage checks are enabled.
   * When disabled, orders execute without slippage validation.
   * Default: true
   */
  enabled: boolean;
}

export const slippageLimitsConfig = registerAs(
  'slippageLimits',
  (): SlippageLimitsConfig => ({
    maxSlippageBps: parseInt(process.env.MAX_SLIPPAGE_BPS || '100', 10),
    warnSlippageBps: parseInt(process.env.WARN_SLIPPAGE_BPS || '50', 10),
    abortOnHighSlippage: process.env.ABORT_ON_HIGH_SLIPPAGE === 'true',
    enabled: process.env.SLIPPAGE_CHECKS_ENABLED !== 'false'
  })
);

export const DEFAULT_SLIPPAGE_LIMITS: SlippageLimitsConfig = {
  maxSlippageBps: 100,
  warnSlippageBps: 50,
  abortOnHighSlippage: false,
  enabled: true
};
