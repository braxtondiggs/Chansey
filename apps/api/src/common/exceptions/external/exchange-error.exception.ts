import { ExternalServiceException } from '../base/external-service.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when an exchange API returns an error.
 */
export class ExchangeErrorException extends ExternalServiceException {
  constructor(message: string, exchangeName?: string) {
    const fullMessage = exchangeName ? `Exchange error (${exchangeName}): ${message}` : `Exchange error: ${message}`;
    super(fullMessage, ErrorCode.EXTERNAL_EXCHANGE_ERROR, exchangeName ? { exchangeName } : undefined);
  }
}
