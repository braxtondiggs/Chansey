import { Throttle } from '@nestjs/throttler';

const isTest = process.env['NODE_ENV'] === 'test';

// Strict rate limiting for authentication endpoints (relaxed in test/E2E mode)
export const AuthThrottle = () =>
  Throttle(
    isTest
      ? { short: { limit: 100, ttl: 1000 }, medium: { limit: 100, ttl: 60000 }, long: { limit: 1000, ttl: 3600000 } }
      : { short: { limit: 3, ttl: 1000 }, medium: { limit: 5, ttl: 60000 }, long: { limit: 20, ttl: 3600000 } }
  );

// Moderate rate limiting for API endpoints
export const ApiThrottle = () =>
  Throttle({
    short: { limit: 5, ttl: 1000 }, // 5 requests per second
    medium: { limit: 50, ttl: 60000 }, // 50 requests per minute
    long: { limit: 500, ttl: 3600000 } // 500 requests per hour
  });

// Strict rate limiting for file upload endpoints
export const UploadThrottle = () =>
  Throttle({
    short: { limit: 1, ttl: 1000 }, // 1 request per second
    medium: { limit: 5, ttl: 60000 }, // 5 requests per minute
    long: { limit: 10, ttl: 3600000 } // 10 requests per hour
  });
