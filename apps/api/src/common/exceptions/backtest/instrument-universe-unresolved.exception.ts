import { BusinessRuleException } from '../base/business-rule.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when a dataset's instrument universe cannot be resolved to actual coins.
 * This prevents backtests from silently running on unintended assets.
 */
export class InstrumentUniverseUnresolvedException extends BusinessRuleException {
  constructor(datasetId: string, requestedInstruments: string[], unresolvedInstruments: string[]) {
    super(
      `Cannot resolve instrument universe for dataset ${datasetId}. ` +
        `Unresolved instruments: [${unresolvedInstruments.join(', ')}]. ` +
        `Ensure all instruments exist as coins in the database.`,
      ErrorCode.BUSINESS_INSTRUMENT_UNIVERSE_UNRESOLVED,
      { datasetId, requestedInstruments, unresolvedInstruments }
    );
  }
}
