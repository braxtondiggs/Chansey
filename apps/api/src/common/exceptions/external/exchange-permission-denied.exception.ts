import { ExternalServiceException } from '../base/external-service.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when an exchange API key lacks required permissions (e.g., trading disabled).
 */
export class ExchangePermissionDeniedException extends ExternalServiceException {
  constructor(exchangeName?: string) {
    const message = exchangeName
      ? `Your API key does not have trading permissions. Please enable trading in your ${exchangeName} account settings.`
      : 'Your API key does not have trading permissions. Please enable trading in your exchange account settings.';
    super(message, ErrorCode.EXTERNAL_EXCHANGE_PERMISSION_DENIED, exchangeName ? { exchangeName } : undefined);
  }
}
