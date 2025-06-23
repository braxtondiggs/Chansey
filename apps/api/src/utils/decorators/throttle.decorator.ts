import { Throttle } from '@nestjs/throttler';

// Strict rate limiting for authentication endpoints
export const AuthThrottle = () =>
  Throttle({
    short: { limit: 3, ttl: 1000 }, // 3 requests per second
    medium: { limit: 5, ttl: 60000 }, // 5 requests per minute
    long: { limit: 20, ttl: 3600000 } // 20 requests per hour
  });

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
