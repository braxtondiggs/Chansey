import { BusinessRuleException } from '../base/business-rule.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when a backtest is run against an algorithm that has no registered strategy.
 */
export class AlgorithmNotRegisteredException extends BusinessRuleException {
  constructor(algorithmId: string) {
    super(
      `No strategy registered for algorithm ${algorithmId}. Ensure the algorithm has an active strategy before running backtests.`,
      ErrorCode.BUSINESS_ALGORITHM_NOT_REGISTERED,
      { algorithmId }
    );
  }
}
