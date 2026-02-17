// OpenTelemetry must be initialized before any other imports
import './instrumentation';

import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import compression from '@fastify/compress';
import fastifyCookie from '@fastify/cookie';
import fastifyCsrf from '@fastify/csrf-protection';
import helmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';

import { AppModule } from './app.module';
import { toErrorInfo } from './shared/error.util';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // Disable Fastify's built-in logger since we're using Pino via nestjs-pino
      logger: false,
      // Router options moved here to comply with Fastify v6 (fixes FSTDEP022 warning)
      routerOptions: {
        ignoreTrailingSlash: true
      }
    }),
    // Use bufferLogs to ensure no logs are lost before pino is initialized
    { bufferLogs: true }
  );

  await registerMiddlewares(app);

  if (process.env.NODE_ENV !== 'production') {
    setupSwagger(app);
  }

  configureGlobalSettings(app);

  await startServer(app);
}

async function registerMiddlewares(app: NestFastifyApplication): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        // Restrict default sources to self
        defaultSrc: [`'self'`],

        // Allow styles from self and specific CDNs
        styleSrc: [`'self'`, 'https://fonts.googleapis.com'],

        // Allow scripts from self and external domains
        scriptSrc: [`'self'`, 'https://www.cymbit.com', 'https://cymbit.com'],

        // Add script-src-elem to explicitly control script elements
        scriptSrcElem: [`'self'`, 'https://www.cymbit.com', 'https://cymbit.com'],

        // Allow images from self, data URIs, and specific domains
        imgSrc: [
          `'self'`,
          'data:',
          'validator.swagger.io',
          'https://fonts.gstatic.com',
          'https://images.pexels.com',
          'https://www.cymbit.com',
          'https://cymbit.com',
          'https://s3.cymbit.com',
          'https://coin-images.coingecko.com'
        ],

        // Allow connections to self and specific APIs
        connectSrc: [
          `'self'`,
          'https://api.coingecko.com',
          'https://api.cryptocurrencyalerting.com',
          'https://www.cymbit.com',
          'https://cymbit.com',
          'https://s3.cymbit.com',
          'https://coin-images.coingecko.com'
        ],

        // Allow fonts from self and specific CDNs
        fontSrc: [`'self'`, 'https://fonts.gstatic.com', 'data:'],

        // Block all object sources (plugins like Flash, Java)
        objectSrc: [`'none'`],

        // Add frame security directive to prevent clickjacking
        frameAncestors: [`'self'`],

        // Add base URI restriction
        baseUri: [`'self'`],

        // Add form-action directive for form submissions
        formAction: [`'self'`],

        // Allow manifest.json files for PWA
        manifestSrc: [`'self'`, 'https://cymbit.com', 'https://www.cymbit.com'],

        // Allow worker sources for service workers
        workerSrc: [`'self'`, 'blob:'],

        // Force HTTPS
        upgradeInsecureRequests: []
      }
    },
    // Hide Express/Fastify server information
    hidePoweredBy: true,

    // Force HSTS with a 1 year max age
    hsts: {
      maxAge: 31536000, // 1 year in seconds
      includeSubDomains: true,
      preload: true
    },

    // Enable X-Content-Type-Options: nosniff
    xContentTypeOptions: true,

    // Enable X-XSS-Protection
    xssFilter: true,

    // Referrer Policy control
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin'
    }
  });

  await app.register(compression, { global: true });

  if (!process.env.COOKIE_SECRET) {
    throw new Error('COOKIE_SECRET environment variable is required');
  }

  await app.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET,
    hook: 'onRequest',
    parseOptions: {
      domain: '.cymbit.com',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/'
    }
  });

  app.enableCors({
    origin: ['https://www.cymbit.com'],
    credentials: true
  });

  await app.register(fastifyCsrf);

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 2 * 1024 * 1024, // 2 MB for images
      files: 1, // Only allow single file uploads
      headerPairs: 100, // Reduced from 2000
      parts: 10, // Reduced from 1000
      fieldNameSize: 100,
      fieldSize: 1024 * 100 // 100 KB field size limit
    },
    attachFieldsToBody: false
  });

  app.useLogger(app.get(Logger));

  app.useGlobalInterceptors(new LoggerErrorInterceptor());
}

function setupSwagger(app: NestFastifyApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Chansey API')
    .setDescription('API documentation for the Chansey application')
    .setVersion('1.0')
    .addServer('/api')
    .addBearerAuth(
      {
        type: 'http',
        bearerFormat: 'JWT',
        description: 'Enter JWT token'
      },
      'token'
    )
    .addApiKey(
      {
        type: 'apiKey',
        description: 'Enter API key'
      },
      'api-key'
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      displayOperationId: true,
      filter: true,
      showRequestDuration: true
    },
    jsonDocumentUrl: '/api-json'
  });
}

function configureGlobalSettings(app: NestFastifyApplication): void {
  const reflector = app.get(Reflector);

  // Set a global prefix for all routes
  app.setGlobalPrefix('api');

  // Enable global validation pipes with transformation
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));

  // Apply ClassSerializerInterceptor globally to handle serialization based on class-transformer decorators
  app.useGlobalInterceptors(new ClassSerializerInterceptor(reflector));
}

async function startServer(app: NestFastifyApplication): Promise<void> {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST || '0.0.0.0';

  // Enable shutdown hooks so NestJS calls onApplicationShutdown lifecycle hooks
  app.enableShutdownHooks();

  try {
    await app.listen(port, host);
    app.get(Logger).log(`🚀 Application is running on: http://${host}:${port}/api`);
  } catch (error: unknown) {
    // Improved error logging for better diagnostics
    const err = toErrorInfo(error);
    const errorDetails = err.stack || err.message || JSON.stringify(error);
    app.get(Logger).error('Error starting the server:', errorDetails);
    process.exit(1);
  }

  const SHUTDOWN_TIMEOUT = 30000; // 30 seconds

  const gracefulShutdown = async (signal: string) => {
    const logger = app.get(Logger);
    logger.log(`Received ${signal}. Starting graceful shutdown...`);

    const shutdownPromise = app.close();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Shutdown timeout exceeded')), SHUTDOWN_TIMEOUT)
    );

    try {
      await Promise.race([shutdownPromise, timeoutPromise]);
      logger.log('Graceful shutdown completed successfully.');
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      logger.warn(`Forced shutdown after timeout: ${err.message}`);
    }

    process.exit(0);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

bootstrap();
