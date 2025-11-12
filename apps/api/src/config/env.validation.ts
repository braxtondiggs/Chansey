import { z } from 'zod';

/**
 * Environment variable validation schema
 *
 * This schema ensures all required environment variables are present and valid
 * before the application starts. If validation fails, the app will exit immediately
 * with a clear error message instead of crashing at runtime.
 *
 * @see {@link https://github.com/colinhacks/zod} Zod documentation
 */
const envSchema = z.object({
  // Application Settings
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().min(1000).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DISABLE_BACKGROUND_TASKS: z
    .string()
    .optional()
    .transform((val) => val === 'true'),

  // Database Configuration (PostgreSQL)
  PGHOST: z.string().min(1, 'PostgreSQL host is required'),
  PGPORT: z.coerce.number().default(5432),
  PGDATABASE: z.string().min(1, 'PostgreSQL database name is required'),
  PGUSER: z.string().min(1, 'PostgreSQL user is required'),
  PGPASSWORD: z.string().min(1, 'PostgreSQL password is required'),

  // Redis Configuration
  REDIS_HOST: z.string().min(1, 'Redis host is required'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_USER: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_TLS: z
    .string()
    .optional()
    .transform((val) => val === 'true'),

  // Authentication & Security
  COOKIE_SECRET: z
    .string()
    .min(32, 'Cookie secret must be at least 32 characters for security')
    .describe('Generate with: openssl rand -base64 32'),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT secret must be at least 32 characters for security')
    .describe('Generate with: openssl rand -base64 32'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT refresh secret must be at least 32 characters for security').optional(),
  JWT_EXPIRATION_TIME: z.string().default('15m'),
  JWT_REFRESH_EXPIRATION_TIME: z.string().default('7d'),

  // Authorizer Configuration
  AUTHORIZER_URL: z.string().url('Authorizer URL must be a valid URL').optional(),
  AUTHORIZER_CLIENT_ID: z.string().optional(),
  AUTHORIZER_REDIRECT_URL: z.string().url('Authorizer redirect URL must be a valid URL').optional(),

  // Storage Configuration (MinIO/S3)
  MINIO_HOST: z.string().optional(),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_USE_SSL: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  MINIO_ACCESS_KEY: z.string().optional(),
  MINIO_SECRET_KEY: z.string().optional(),
  MINIO_BUCKET_NAME: z.string().default('chansey'),
  MINIO_BUCKET_REGION: z.string().default('us-east-1'),

  // External API Keys (Optional)
  COINGECKO_API_KEY: z.string().optional(),
  CCA_API_KEY: z.string().optional(),
  CHANSEY_API_KEY: z.string().optional(),

  // Exchange API Keys (Optional - stored per-user in database)
  BINANCE_API_KEY: z.string().optional(),
  BINANCE_API_SECRET: z.string().optional(),
  COINBASE_API_KEY: z.string().optional(),
  COINBASE_API_SECRET: z.string().optional(),
  COINBASE_API_PASSPHRASE: z.string().optional()
});

/**
 * Inferred TypeScript type from the Zod schema
 * Use this type for type-safe access to environment variables
 */
export type Env = z.infer<typeof envSchema>;

/**
 * Validates environment variables against the schema
 *
 * @returns Validated and typed environment variables
 * @throws {z.ZodError} If validation fails (app will exit)
 *
 * @example
 * ```typescript
 * // In app.module.ts
 * ConfigModule.forRoot({
 *   validate: validateEnv
 * })
 * ```
 */
export function validateEnv(config: Record<string, unknown>): Env {
  try {
    return envSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars: string[] = [];
      const invalidVars: string[] = [];

      error.errors.forEach((err) => {
        const path = err.path.join('.');
        if (err.code === 'invalid_type' && err.received === 'undefined') {
          missingVars.push(`  ❌ ${path}: ${err.message}`);
        } else {
          invalidVars.push(`  ⚠️  ${path}: ${err.message}`);
        }
      });

      console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('❌ ENVIRONMENT VALIDATION FAILED');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      if (missingVars.length > 0) {
        console.error('Missing required environment variables:');
        missingVars.forEach((msg) => console.error(msg));
        console.error('');
      }

      if (invalidVars.length > 0) {
        console.error('Invalid environment variable values:');
        invalidVars.forEach((msg) => console.error(msg));
        console.error('');
      }

      console.error('💡 TIP: Check your .env file against .env.example');
      console.error('   Run: cp .env.example .env\n');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      process.exit(1);
    }
    throw error;
  }
}
