import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { Client as MinioClient } from 'minio';

import { MINIO_CLIENT } from './storage.constants';
import { StorageService } from './storage.service';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MINIO_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): MinioClient => {
        return new MinioClient({
          endPoint: configService.get<string>('MINIO_HOST') || 'localhost',
          port: parseInt(configService.get<string>('MINIO_PORT') || '9000', 10),
          useSSL: configService.get<string>('MINIO_USE_SSL') === 'true',
          accessKey: configService.get<string>('MINIO_ACCESS_KEY') || 'minioadmin',
          secretKey: configService.get<string>('MINIO_SECRET_KEY') || 'minioadmin'
        });
      }
    },
    StorageService
  ],
  exports: [StorageService, MINIO_CLIENT]
})
export class StorageModule {}
