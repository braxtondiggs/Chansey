import { ExternalServiceException } from '../base/external-service.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when an exchange is unavailable.
 */
export class ExchangeUnavailableException extends ExternalServiceException {
  constructor(exchangeName?: string) {
    const message = exchangeName
      ? `Exchange ${exchangeName} is currently unavailable`
      : 'Exchange is currently unavailable';
    super(message, ErrorCode.EXTERNAL_EXCHANGE_UNAVAILABLE, exchangeName ? { exchangeName } : undefined);
  }
}
