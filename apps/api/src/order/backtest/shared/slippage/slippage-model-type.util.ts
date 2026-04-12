import { SlippageModelType } from './slippage.interface';

/**
 * Map legacy slippage model type string to shared enum.
 * Pure function — no dependencies on any service.
 */
export function mapSlippageModelType(model?: string): SlippageModelType {
  switch (model) {
    case 'none':
      return SlippageModelType.NONE;
    case 'volume-based':
      return SlippageModelType.VOLUME_BASED;
    case 'historical':
      return SlippageModelType.HISTORICAL;
    case 'spread-adjusted':
      return SlippageModelType.SPREAD_ADJUSTED;
    case 'fixed':
    default:
      return SlippageModelType.FIXED;
  }
}
