/**
 * OpenTelemetry Instrumentation
 *
 * This file MUST be loaded before any other imports to properly instrument
 * the application. It configures distributed tracing with Tempo integration.
 *
 * Note: This file uses a lightweight bootstrap logger since it runs before
 * NestJS and Pino are initialized. The logger outputs JSON for consistency
 * with the main application logs.
 *
 * @see {@link https://opentelemetry.io/docs/instrumentation/js/getting-started/nodejs/}
 */

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION
} from '@opentelemetry/semantic-conventions';

/**
 * Lightweight bootstrap logger for pre-NestJS initialization.
 * Outputs structured JSON to maintain consistency with Pino logs.
 */
const bootstrapLog = (level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) => {
  const entry = {
    level,
    time: Date.now(),
    context: 'OpenTelemetry',
    msg,
    ...data
  };
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(entry) + '\n');
};

const isTracingEnabled = !!process.env.TEMPO_ENDPOINT;

if (isTracingEnabled) {
  const traceExporter = new OTLPTraceExporter({
    url: `${process.env.TEMPO_ENDPOINT}/v1/traces`,
    headers: process.env.TEMPO_AUTH_HEADER ? { Authorization: process.env.TEMPO_AUTH_HEADER } : undefined
  });

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'chansey-api',
      [SEMRESATTRS_SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development'
    }),
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Instrument HTTP client/server requests
        '@opentelemetry/instrumentation-http': {
          enabled: true,
          ignoreIncomingRequestHook: (req) => {
            const url = req.url || '';
            // Ignore health, metrics (Prometheus), and bull-board endpoints
            return (
              url === '/api/health' ||
              url === '/api/metrics' ||
              url.startsWith('/metrics') ||
              url.startsWith('/bull-board')
            );
          }
        },
        // Instrument Fastify
        '@opentelemetry/instrumentation-fastify': {
          enabled: true
        },
        // Instrument PostgreSQL
        '@opentelemetry/instrumentation-pg': {
          enabled: true
        },
        // Instrument Redis (ioredis)
        '@opentelemetry/instrumentation-ioredis': {
          enabled: true
        },
        // Disable file system instrumentation (too noisy)
        '@opentelemetry/instrumentation-fs': {
          enabled: false
        },
        // Disable DNS instrumentation (too noisy)
        '@opentelemetry/instrumentation-dns': {
          enabled: false
        }
      })
    ]
  });

  sdk.start();

  // Graceful shutdown
  const shutdown = () => {
    sdk.shutdown().then(
      () => bootstrapLog('info', 'Tracing terminated'),
      (error) => bootstrapLog('error', 'Error terminating tracing', { error: String(error) })
    );
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  bootstrapLog('info', 'OpenTelemetry tracing enabled', { endpoint: process.env.TEMPO_ENDPOINT });
} else {
  bootstrapLog('info', 'OpenTelemetry tracing disabled - TEMPO_ENDPOINT not configured');
}
