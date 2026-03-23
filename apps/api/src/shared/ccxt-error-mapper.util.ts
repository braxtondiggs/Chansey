import { HttpException } from '@nestjs/common';

import { AppException } from '../common/exceptions/base/app.exception';
import {
  ExchangeAuthFailedException,
  ExchangeErrorException,
  ExchangePermissionDeniedException,
  ExchangeRateLimitedException,
  ExchangeUnavailableException
} from '../common/exceptions/external';
import { InsufficientBalanceException } from '../common/exceptions/order';

/**
 * Strip raw JSON and exchange-specific noise from error messages
 * to produce human-readable text.
 */
export function cleanExchangeMessage(raw: string): string {
  // Try to extract "msg" from JSON-like payloads: {"code":-2015,"msg":"..."}
  const msgMatch = raw.match(/"msg"\s*:\s*"([^"]+)"/);
  if (msgMatch) return msgMatch[1];

  // Strip leading exchange name prefix only when followed by JSON (e.g. "binanceus {...}")
  const jsonStart = raw.indexOf('{');
  const stripped = jsonStart > 0 ? raw.slice(jsonStart) : raw;

  // If what remains looks like JSON, try to extract a message field
  if (stripped.startsWith('{')) {
    try {
      const parsed = JSON.parse(stripped);
      if (typeof parsed.message === 'string') return parsed.message;
      if (typeof parsed.msg === 'string') return parsed.msg;
      if (typeof parsed.error === 'string') return parsed.error;
    } catch {
      // Not valid JSON — fall through
    }
  }

  return raw;
}

/**
 * Maps CCXT errors to structured application exceptions.
 *
 * @param error - The caught error (usually a CCXT exception)
 * @param exchangeName - Optional exchange name for user-facing messages
 * @throws Always throws — the return type is `never`
 */
export function mapCcxtError(error: unknown, exchangeName?: string): never {
  // Pass through existing exceptions to avoid double-wrapping
  // (AppException = our structured errors, HttpException = NestJS validation/auth errors)
  if (error instanceof AppException || error instanceof HttpException) {
    throw error;
  }

  if (!(error instanceof Error)) {
    throw new ExchangeErrorException(String(error), exchangeName);
  }

  const className = error.constructor.name;
  const message = error.message || '';

  switch (className) {
    case 'PermissionDenied':
      throw new ExchangePermissionDeniedException(exchangeName);

    case 'AuthenticationError':
      throw new ExchangeAuthFailedException(undefined, exchangeName);

    case 'AccountSuspended':
      throw new ExchangeAuthFailedException(
        exchangeName
          ? `Your ${exchangeName} account has been suspended. Please contact ${exchangeName} support.`
          : 'Your exchange account has been suspended. Please contact exchange support.',
        exchangeName
      );

    case 'InsufficientFunds': {
      // Try to parse currency from message like "Account has insufficient balance for requested action."
      // or "Insufficient balance: 0 BTC available"
      const currencyMatch = message.match(/(\d[\d.]*)\s+(\w+)\s+available/i);
      if (currencyMatch) {
        throw new InsufficientBalanceException(currencyMatch[2], currencyMatch[1], 'unknown');
      }
      // Always throw InsufficientBalanceException — even when we can't parse specifics
      throw new InsufficientBalanceException('unknown', 'unknown', 'unknown');
    }

    case 'InvalidOrder':
      throw new ExchangeErrorException(cleanExchangeMessage(message) || 'Invalid order', exchangeName);

    case 'RateLimitExceeded':
    case 'DDoSProtection':
      throw new ExchangeRateLimitedException(exchangeName);

    case 'ExchangeNotAvailable':
    case 'NetworkError':
    case 'RequestTimeout':
      throw new ExchangeUnavailableException(exchangeName);

    default:
      throw new ExchangeErrorException(cleanExchangeMessage(message) || 'Unknown exchange error', exchangeName);
  }
}
