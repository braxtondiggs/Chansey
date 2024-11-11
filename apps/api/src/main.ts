import compression from '@fastify/compress';
import fastifyCookie from '@fastify/cookie';
import fastifyCsrf from '@fastify/csrf-protection';
import helmet from '@fastify/helmet';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
        defaultSrc: [`'self'`],
        styleSrc: [`'self'`, `'unsafe-inline'`],
        imgSrc: [`'self'`, 'data:', 'validator.swagger.io'],
        scriptSrc: [`'self'`, `'unsafe-inline'`, 'https:'],
        connectSrc: [`'self'`],
        fontSrc: [`'self'`, 'https:', 'data:'],
        objectSrc: [`'none'`],
        upgradeInsecureRequests: []
      }
    },
    hidePoweredBy: true
  });

  await app.register(compression, { global: true });

  await app.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET || 'default_secret', // Replace with a secure secret in production
    hook: 'onRequest',
    parseOptions: {}
  });

  await app.register(fastifyCsrf);

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
    app.get(Logger).error('Error starting the server:', error);
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
