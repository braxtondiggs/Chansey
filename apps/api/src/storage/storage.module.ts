import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { NestMinioModule } from 'nestjs-minio';

import { StorageService } from './storage.service';

@Module({
  imports: [
    ConfigModule,
    NestMinioModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        endPoint: configService.get<string>('MINIO_HOST') || 'localhost',
        port: parseInt(configService.get<string>('MINIO_PORT') || '9000', 10),
        useSSL: configService.get<string>('MINIO_USE_SSL') === 'true',
        accessKey: configService.get<string>('MINIO_ACCESS_KEY') || 'minioadmin',
        secretKey: configService.get<string>('MINIO_SECRET_KEY') || 'minioadmin'
      })
    })
  ],
  providers: [StorageService],
  exports: [StorageService]
})
export class StorageModule {}
