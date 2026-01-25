/**
 * Logger Configuration
 *
 * Configures Pino logger with improved formatting and optional Loki transport.
 *
 * Features:
 * - Clean, readable dev output with color-coded log levels
 * - Structured JSON logs in production
 * - Request correlation via trace IDs
 * - Automatic sensitive data redaction
 * - Optional Grafana Loki integration
 */

import type { Params } from 'nestjs-pino';
import type { TransportTargetOptions } from 'pino';

import { randomUUID } from 'crypto';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Lightweight bootstrap logger for configuration phase.
 * Used before Pino is fully initialized to maintain structured output.
 */
const bootstrapLog = (level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) => {
  const entry = {
    level,
    time: Date.now(),
    context: 'LoggerConfig',
    msg,
    ...data
  };
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(entry) + '\n');
};

/**
 * Routes to exclude from automatic request logging
 */
const IGNORED_ROUTES = ['/api/health', '/api/metrics', '/metrics', '/bull-board'];

/**
 * Sensitive paths to redact from logs
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'body.password',
  'body.apiKey',
  'body.apiSecret',
  'body.token',
  'body.refreshToken',
  'body.secretKey',
  'body.privateKey'
];

/**
 * Build Pino transports configuration
 */
function buildTransports(): { targets: TransportTargetOptions[] } | undefined {
  const lokiEndpoint = process.env.LOKI_ENDPOINT;
  const targets: TransportTargetOptions[] = [];

  if (isProduction) {
    // Structured JSON output for production (optimized for log aggregation)
    targets.push({
      target: 'pino/file',
      level: 'info',
      options: { destination: 1 }
    });
  } else {
    // Clean, readable output for development
    targets.push({
      target: 'pino-pretty',
      level: 'debug',
      options: {
        colorize: true,
        colorizeObjects: true,
        singleLine: false,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname,req,res',
        messageFormat: '{if context}[{context}] {end}{msg}{if responseTime} ({responseTime}ms){end}'
      }
    });
  }

  // Add Loki transport if configured
  if (lokiEndpoint) {
    const lokiOptions: Record<string, unknown> = {
      host: lokiEndpoint,
      batching: true,
      interval: 5,
      labels: {
        app: 'chansey-api',
        env: process.env.NODE_ENV || 'development'
      },
      replaceTimestamp: false,
      silenceErrors: false
    };

    if (process.env.LOKI_USERNAME && process.env.LOKI_PASSWORD) {
      lokiOptions.basicAuth = {
        username: process.env.LOKI_USERNAME,
        password: process.env.LOKI_PASSWORD
      };
    }

    targets.push({
      target: 'pino-loki',
      level: isProduction ? 'info' : 'debug',
      options: lokiOptions
    });

    bootstrapLog('info', 'Loki logging enabled', { endpoint: lokiEndpoint });
  }

  return targets.length > 0 ? { targets } : undefined;
}

/**
 * Check if a route should be ignored for logging
 */
function shouldIgnoreRoute(url?: string): boolean {
  if (!url) return false;
  return IGNORED_ROUTES.some((route) => url === route || url.startsWith(route + '/') || url.startsWith(route + '?'));
}

/**
 * Extract trace ID from request headers
 */
function extractTraceId(headers: Record<string, string | string[] | undefined>): string | undefined {
  // W3C traceparent format: version-traceId-parentId-flags
  const traceparent = headers['traceparent']?.toString();
  if (traceparent) {
    const parts = traceparent.split('-');
    if (parts.length >= 2) return parts[1];
  }
  return undefined;
}

/**
 * Generate or extract request ID
 */
function generateRequestId(headers: Record<string, string | string[] | undefined>): string {
  return (
    (headers['x-request-id'] as string) ||
    (headers['x-correlation-id'] as string) ||
    extractTraceId(headers) ||
    randomUUID()
  );
}

/**
 * Create LoggerModule configuration
 */
export function createLoggerConfig(): Params {
  const transport = buildTransports();

  const pinoHttpOptions: Record<string, unknown> = {
    // Log level
    level: isProduction ? 'info' : 'debug',

    // Auto-logging configuration
    autoLogging: {
      ignore: (req: { url?: string }) => shouldIgnoreRoute(req.url)
    },

    // Request ID generation
    genReqId: (req: { headers: Record<string, string | string[] | undefined> }) => generateRequestId(req.headers),

    // Dynamic log levels based on response status
    customLogLevel: (_req: unknown, res: { statusCode: number }, err: Error | undefined) => {
      if (res.statusCode >= 500 || err) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },

    // Cleaner log messages
    customSuccessMessage: (req: { method?: string; url?: string }, res: { statusCode: number }) => {
      const method = req.method || 'UNKNOWN';
      const url = req.url || '/';
      return `${method} ${url} - ${res.statusCode}`;
    },

    customErrorMessage: (
      req: { method?: string; url?: string },
      res: { statusCode: number },
      err: { message: string }
    ) => {
      const method = req.method || 'UNKNOWN';
      const url = req.url || '/';
      return `${method} ${url} - ${res.statusCode} - ${err.message}`;
    },

    // Add trace context for correlation
    customProps: (req: { headers: Record<string, string | string[] | undefined> }) => {
      const traceId = extractTraceId(req.headers);
      const spanId = req.headers['traceparent']?.toString().split('-')[2];

      return {
        ...(traceId && { traceId }),
        ...(spanId && { spanId })
      };
    },

    // Redact sensitive information
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]'
    },

    // Serializers for cleaner output
    serializers: {
      req: (req: { method?: string; url?: string; headers?: Record<string, unknown>; id?: string }) => ({
        method: req.method,
        url: req.url,
        id: req.id
      }),
      res: (res: { statusCode?: number }) => ({
        statusCode: res.statusCode
      }),
      err: (err: { type?: string; message?: string; stack?: string }) => ({
        type: err.type,
        message: err.message,
        ...(isProduction ? {} : { stack: err.stack })
      })
    }
  };

  // Add transport if configured
  if (transport) {
    pinoHttpOptions.transport = transport;
  }

  return {
    pinoHttp: pinoHttpOptions as Params['pinoHttp'],
    // Forward logs to NestJS Logger for consistent output
    // Note: Using '{*path}' to comply with path-to-regexp v8+ syntax (fixes FSTDEP deprecation warning)
    forRoutes: ['{*path}'],
    // Exclude routes from request logging
    exclude: []
  };
}
