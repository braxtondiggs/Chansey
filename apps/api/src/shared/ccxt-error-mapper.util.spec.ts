import {
  AccountSuspended,
  AuthenticationError,
  DDoSProtection,
  ExchangeError,
  ExchangeNotAvailable,
  InsufficientFunds,
  InvalidOrder,
  NetworkError,
  PermissionDenied,
  RateLimitExceeded,
  RequestTimeout
} from 'ccxt';

import { cleanExchangeMessage, mapCcxtError } from './ccxt-error-mapper.util';

import {
  ExchangeAuthFailedException,
  ExchangeErrorException,
  ExchangePermissionDeniedException,
  ExchangeRateLimitedException,
  ExchangeUnavailableException
} from '../common/exceptions/external';
import { InsufficientBalanceException } from '../common/exceptions/order';

describe('mapCcxtError', () => {
  it('should pass through AppException instances without wrapping', () => {
    const original = new ExchangeErrorException('already mapped', 'Binance');
    expect(() => mapCcxtError(original, 'Binance')).toThrow(original);
  });

  it('should pass through HttpException instances without wrapping', () => {
    const { BadRequestException } = jest.requireActual('@nestjs/common');
    const original = new BadRequestException('validation failed');
    expect(() => mapCcxtError(original, 'Binance')).toThrow(original);
  });

  it('should map PermissionDenied to ExchangePermissionDeniedException', () => {
    const err = new PermissionDenied('binanceus {"code":-2015,"msg":"Invalid API-key"}');
    expect(() => mapCcxtError(err, 'Binance US')).toThrow(ExchangePermissionDeniedException);
  });

  it('should map AuthenticationError to ExchangeAuthFailedException', () => {
    const err = new AuthenticationError('Invalid API key');
    expect(() => mapCcxtError(err, 'Coinbase')).toThrow(ExchangeAuthFailedException);
  });

  it('should map AccountSuspended with exchange name to ExchangeAuthFailedException', () => {
    const err = new AccountSuspended('account suspended');
    expect(() => mapCcxtError(err, 'Binance')).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('Binance')
      })
    );
    expect(() => mapCcxtError(err, 'Binance')).toThrow(ExchangeAuthFailedException);
  });

  it('should map AccountSuspended without exchange name to generic suspension message', () => {
    const err = new AccountSuspended('account suspended');
    expect(() => mapCcxtError(err)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('exchange support')
      })
    );
    expect(() => mapCcxtError(err)).toThrow(ExchangeAuthFailedException);
  });

  it('should map InsufficientFunds with parseable currency to InsufficientBalanceException', () => {
    const err = new InsufficientFunds('Insufficient balance: 0.5 BTC available');
    expect(() => mapCcxtError(err, 'Binance')).toThrow(InsufficientBalanceException);
  });

  it('should map InsufficientFunds without parseable currency to InsufficientBalanceException', () => {
    const err = new InsufficientFunds('Account has insufficient balance');
    expect(() => mapCcxtError(err, 'Binance')).toThrow(InsufficientBalanceException);
  });

  it('should map InvalidOrder to ExchangeErrorException with cleaned message', () => {
    const err = new InvalidOrder('binanceus {"code":-1013,"msg":"Invalid quantity."}');
    expect(() => mapCcxtError(err, 'Binance US')).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('Invalid quantity.')
      })
    );
  });

  it('should map RateLimitExceeded to ExchangeRateLimitedException', () => {
    const err = new RateLimitExceeded('Too many requests');
    expect(() => mapCcxtError(err, 'Binance')).toThrow(ExchangeRateLimitedException);
  });

  it('should map DDoSProtection without permission message to ExchangeRateLimitedException', () => {
    const err = new DDoSProtection('Rate limit triggered');
    expect(() => mapCcxtError(err, 'Binance')).toThrow(ExchangeRateLimitedException);
  });

  it('should map DDoSProtection with permission message to ExchangePermissionDeniedException', () => {
    const err = new DDoSProtection('binanceus {"code":-2015,"msg":"Invalid API-key, IP, or permissions for action."}');
    expect(() => mapCcxtError(err, 'Binance US')).toThrow(ExchangePermissionDeniedException);
  });

  it.each([
    ['ExchangeNotAvailable', ExchangeNotAvailable, 'Exchange is down'],
    ['NetworkError', NetworkError, 'ECONNREFUSED'],
    ['RequestTimeout', RequestTimeout, 'timeout']
  ] as const)('should map %s to ExchangeUnavailableException', (_name, ErrorClass, message) => {
    const err = new ErrorClass(message);
    expect(() => mapCcxtError(err, 'Binance')).toThrow(ExchangeUnavailableException);
  });

  it('should map unknown CCXT errors to ExchangeErrorException', () => {
    const err = new ExchangeError('something broke');
    expect(() => mapCcxtError(err, 'Binance')).toThrow(ExchangeErrorException);
  });

  it('should handle non-Error values', () => {
    expect(() => mapCcxtError('raw string error', 'Binance')).toThrow(ExchangeErrorException);
  });

  it('should include exchange name in PermissionDenied message when provided', () => {
    const err = new PermissionDenied('no perms');
    expect(() => mapCcxtError(err, 'Binance US')).toThrow(ExchangePermissionDeniedException);
    expect(() => mapCcxtError(err)).toThrow(ExchangePermissionDeniedException);
  });
});

describe('cleanExchangeMessage', () => {
  it('should extract msg from JSON-like payload via regex', () => {
    expect(
      cleanExchangeMessage('binanceus {"code":-2015,"msg":"Invalid API-key, IP, or permissions for action."}')
    ).toBe('Invalid API-key, IP, or permissions for action.');
  });

  it('should extract message field from clean JSON after stripping prefix', () => {
    expect(cleanExchangeMessage('exchangeName {"message":"Order too small"}')).toBe('Order too small');
  });

  it('should extract error field from stripped JSON', () => {
    expect(cleanExchangeMessage('exch {"error":"Something failed"}')).toBe('Something failed');
  });

  it('should return raw message when no JSON is present', () => {
    expect(cleanExchangeMessage('Simple error message')).toBe('Simple error message');
  });

  it('should return raw message when stripped JSON is malformed', () => {
    expect(cleanExchangeMessage('exch {not valid json}')).toBe('exch {not valid json}');
  });

  it('should preserve multi-word messages without JSON', () => {
    expect(cleanExchangeMessage('Unauthorized access denied')).toBe('Unauthorized access denied');
  });

  it('should handle escaped quotes in msg field', () => {
    expect(cleanExchangeMessage('{"code":-1,"msg":"Invalid symbol: \\"BTC/USD\\""}')).toBe(
      'Invalid symbol: \\"BTC/USD\\"'
    );
  });
});
