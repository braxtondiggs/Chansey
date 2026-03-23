import { ExternalServiceException } from '../base/external-service.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when exchange authentication fails (invalid/expired API key).
 */
export class ExchangeAuthFailedException extends ExternalServiceException {
  constructor(message?: string, exchangeName?: string) {
    const fullMessage =
      message ||
      (exchangeName
        ? `Invalid API key for ${exchangeName}. Please verify your API key is correct and has not expired.`
        : 'Invalid API key. Please verify your API key is correct and has not expired.');
    super(fullMessage, ErrorCode.EXTERNAL_EXCHANGE_AUTH_FAILED, exchangeName ? { exchangeName } : undefined);
  }
}
