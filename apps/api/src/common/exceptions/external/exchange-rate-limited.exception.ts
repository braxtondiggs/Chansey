import { ExternalServiceException } from '../base/external-service.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when an exchange rate-limits API requests.
 */
export class ExchangeRateLimitedException extends ExternalServiceException {
  constructor(exchangeName?: string) {
    const message = exchangeName
      ? `Rate limit exceeded for ${exchangeName}. Please try again in a few moments.`
      : 'Rate limit exceeded. Please try again in a few moments.';
    super(message, ErrorCode.EXTERNAL_EXCHANGE_RATE_LIMITED, exchangeName ? { exchangeName } : undefined);
  }
}
