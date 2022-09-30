
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import compression from '@fastify/compress';
import helmet from '@fastify/helmet';
import fastifyCsrf from '@fastify/csrf-protection';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      ignoreTrailingSlash: true
    })
  );

  await app.register(helmet);
  await app.register(fastifyCsrf);
  await app.register(compression);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0', () => {
    if (process.env.NODE_ENV !== 'production') {
      Logger.log(`🚀 Application is running on: http://localhost:${port}/api`);
    }
  });
}

bootstrap();
