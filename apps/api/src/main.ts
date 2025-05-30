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

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      ignoreTrailingSlash: true,
      logger: true
    })
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
        styleSrc: [`'self'`, `'unsafe-inline'`, 'https://fonts.googleapis.com'],

        // Allow scripts from self, external domains, and needed CSP directives
        scriptSrc: [`'self'`, `'unsafe-inline'`, `'unsafe-eval'`, 'https://www.cymbit.com', 'https://cymbit.com'],

        // Add script-src-elem to explicitly control script elements
        scriptSrcElem: [`'self'`, `'unsafe-inline'`, 'https://www.cymbit.com', 'https://cymbit.com'],

        // Add script-src-attr to allow inline event handlers
        scriptSrcAttr: [`'unsafe-inline'`],

        // Allow images from self, data URIs, and specific domains
        imgSrc: [
          `'self'`,
          'data:',
          'validator.swagger.io',
          'https://fonts.gstatic.com',
          'https://images.pexels.com',
          'https://www.cymbit.com',
          'https://cymbit.com',
          'https://coin-images.coingecko.com'
        ],

        // Allow connections to self and specific APIs
        connectSrc: [
          `'self'`,
          'https://api.coingecko.com',
          'https://api.cryptocurrencyalerting.com',
          'https://www.cymbit.com',
          'https://cymbit.com'
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

  await app.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET || 'default_secret', // Replace with a secure secret in production
    hook: 'onRequest',
    parseOptions: { domain: '.cymbit.com' }
  });

  app.enableCors({
    origin: ['https://www.cymbit.com'],
    credentials: true
  });

  await app.register(fastifyCsrf);

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 2 MB
      files: 1,
      headerPairs: 2000,
      parts: 1000
    }
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
  const port = parseInt(process.env.PORT, 10) || 3000;
  const host = process.env.HOST || '0.0.0.0';

  try {
    await app.listen(port, host);
    app.get(Logger).log(`🚀 Application is running on: http://${host}:${port}/api`);
  } catch (error) {
    // Improved error logging for better diagnostics
    const errorDetails = error?.stack || error?.message || JSON.stringify(error);
    app.get(Logger).error('Error starting the server:', errorDetails);
    process.exit(1);
  }

  process.on('SIGINT', async () => {
    app.get(Logger).log('Received SIGINT. Shutting down gracefully...');
    await app.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    app.get(Logger).log('Received SIGTERM. Shutting down gracefully...');
    await app.close();
    process.exit(0);
  });
}

bootstrap();
