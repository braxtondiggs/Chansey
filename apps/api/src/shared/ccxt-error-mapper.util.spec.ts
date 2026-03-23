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
    const original = new ExchangeErrorException('already mapped', 'binance');
    expect(() => mapCcxtError(original, 'binance')).toThrow(original);
  });

  it('should pass through HttpException instances without wrapping', () => {
    const { BadRequestException } = jest.requireActual('@nestjs/common');
    const original = new BadRequestException('validation failed');
    expect(() => mapCcxtError(original, 'binance')).toThrow(original);
  });

  it('should map PermissionDenied to ExchangePermissionDeniedException', () => {
    const err = new PermissionDenied('binanceus {"code":-2015,"msg":"Invalid API-key"}');
    expect(() => mapCcxtError(err, 'binanceus')).toThrow(ExchangePermissionDeniedException);
  });

  it('should map AuthenticationError to ExchangeAuthFailedException', () => {
    const err = new AuthenticationError('Invalid API key');
    expect(() => mapCcxtError(err, 'coinbase')).toThrow(ExchangeAuthFailedException);
  });

  it('should map AccountSuspended with exchange name to ExchangeAuthFailedException', () => {
    const err = new AccountSuspended('account suspended');
    expect(() => mapCcxtError(err, 'binance')).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('binance')
      })
    );
    expect(() => mapCcxtError(err, 'binance')).toThrow(ExchangeAuthFailedException);
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
    expect(() => mapCcxtError(err, 'binance')).toThrow(InsufficientBalanceException);
  });

  it('should map InsufficientFunds without parseable currency to InsufficientBalanceException', () => {
    const err = new InsufficientFunds('Account has insufficient balance');
    expect(() => mapCcxtError(err, 'binance')).toThrow(InsufficientBalanceException);
  });

  it('should map InvalidOrder to ExchangeErrorException with cleaned message', () => {
    const err = new InvalidOrder('binanceus {"code":-1013,"msg":"Invalid quantity."}');
    expect(() => mapCcxtError(err, 'binanceus')).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('Invalid quantity.')
      })
    );
  });

  it.each([
    ['RateLimitExceeded', RateLimitExceeded, 'Too many requests'],
    ['DDoSProtection', DDoSProtection, 'DDoS protection triggered']
  ] as const)('should map %s to ExchangeRateLimitedException', (_name, ErrorClass, message) => {
    const err = new ErrorClass(message);
    expect(() => mapCcxtError(err, 'binance')).toThrow(ExchangeRateLimitedException);
  });

  it.each([
    ['ExchangeNotAvailable', ExchangeNotAvailable, 'Exchange is down'],
    ['NetworkError', NetworkError, 'ECONNREFUSED'],
    ['RequestTimeout', RequestTimeout, 'timeout']
  ] as const)('should map %s to ExchangeUnavailableException', (_name, ErrorClass, message) => {
    const err = new ErrorClass(message);
    expect(() => mapCcxtError(err, 'binance')).toThrow(ExchangeUnavailableException);
  });

  it('should map unknown CCXT errors to ExchangeErrorException', () => {
    const err = new ExchangeError('something broke');
    expect(() => mapCcxtError(err, 'binance')).toThrow(ExchangeErrorException);
  });

  it('should handle non-Error values', () => {
    expect(() => mapCcxtError('raw string error', 'binance')).toThrow(ExchangeErrorException);
  });

  it('should include exchange name in PermissionDenied message when provided', () => {
    const err = new PermissionDenied('no perms');
    expect(() => mapCcxtError(err, 'binanceus')).toThrow(ExchangePermissionDeniedException);
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
