import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Client as MinioClient } from 'minio';

import { MINIO_CLIENT } from './storage.constants';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucketName: string;
  private readonly bucketRegion: string;
  private readonly minioHost: string;
  private readonly minioPort: number;
  private readonly minioUseSSL: boolean;
  private readonly enablePublicAccess: boolean;
  private readonly publicAccessFolders: string[];
  private isConnected = false;

  constructor(
    @Inject(MINIO_CLIENT) private readonly minioClient: MinioClient,
    private readonly configService: ConfigService
  ) {
    // Read MinIO configuration from environment variables
    this.minioHost = this.configService.get<string>('MINIO_HOST');
    this.minioPort = parseInt(this.configService.get<string>('MINIO_PORT'), 10);
    this.bucketName = this.configService.get<string>('MINIO_BUCKET_NAME');
    this.bucketRegion = this.configService.get<string>('MINIO_BUCKET_REGION');
    this.minioUseSSL = this.configService.get<string>('MINIO_USE_SSL') === 'true';
    // Security: Only enable public access if explicitly configured
    this.enablePublicAccess = this.configService.get<string>('MINIO_ENABLE_PUBLIC_ACCESS') === 'true';
    // Restrict public access to specific folders (default: profile-images only)
    const foldersConfig = this.configService.get<string>('MINIO_PUBLIC_FOLDERS') || 'profile-images';
    this.publicAccessFolders = foldersConfig.split(',').map((f) => f.trim());
  }

  async onModuleInit() {
    try {
      await this.checkAndCreateBucket();
      this.isConnected = true;
      this.logger.log('Storage service initialized successfully');
    } catch (error) {
      this.isConnected = false;
      this.logger.warn(`Storage service unavailable - file uploads disabled: ${error.message}`);
    }
  }

  // Check if storage is available
  isAvailable(): boolean {
    return this.isConnected;
  }

  // Check if the bucket exists, if not create it
  private async checkAndCreateBucket(): Promise<void> {
    const exists = await this.minioClient.bucketExists(this.bucketName);
    if (!exists) {
      await this.minioClient.makeBucket(this.bucketName, this.bucketRegion);
      this.logger.log(`Bucket '${this.bucketName}' created successfully`);

      // Only set public read access if explicitly enabled via environment variable
      if (this.enablePublicAccess) {
        // Restrict public access to specific folders only
        const resources = this.publicAccessFolders.map((folder) => `arn:aws:s3:::${this.bucketName}/${folder}/*`);
        const policy = {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: resources
            }
          ]
        };
        await this.minioClient.setBucketPolicy(this.bucketName, JSON.stringify(policy));
        this.logger.log(
          `Bucket '${this.bucketName}' policy set to public read for folders: ${this.publicAccessFolders.join(', ')}`
        );
      } else {
        this.logger.log(
          `Bucket '${this.bucketName}' created with private access (set MINIO_ENABLE_PUBLIC_ACCESS=true to enable public read)`
        );
      }
    } else {
      this.logger.log(`Bucket '${this.bucketName}' already exists`);
    }
  }

  // Upload a file to MinIO
  async uploadFile(file: Buffer, contentType: string, fileName: string, folder = 'profile-images'): Promise<string> {
    if (!this.isConnected) {
      throw new Error('Storage service is not available');
    }

    try {
      const objectName = `${folder}/${Date.now()}-${fileName}`;

      await this.minioClient.putObject(this.bucketName, objectName, file, undefined, { 'Content-Type': contentType });

      // Construct the public URL to the uploaded file
      // Don't include port for standard ports (443 for HTTPS, 80 for HTTP)
      const isStandardPort =
        (this.minioUseSSL && this.minioPort === 443) || (!this.minioUseSSL && this.minioPort === 80);
      const baseUrl = this.minioUseSSL
        ? `https://${this.minioHost}${isStandardPort ? '' : `:${this.minioPort}`}`
        : `http://${this.minioHost}${isStandardPort ? '' : `:${this.minioPort}`}`;

      const fileUrl = `${baseUrl}/${this.bucketName}/${objectName}`;
      this.logger.log(`File uploaded successfully: ${fileUrl}`);

      return fileUrl;
    } catch (error) {
      this.logger.error(`Error uploading file: ${error.message}`, error.stack);
      throw error;
    }
  }

  // Delete a file from MinIO
  async deleteFile(fileUrl: string): Promise<void> {
    if (!this.isConnected) {
      this.logger.warn('Storage service is not available - skipping file deletion');
      return;
    }

    try {
      // Extract the object name from the file URL
      const urlObj = new URL(fileUrl);
      const objectPath = urlObj.pathname;
      const objectName = objectPath.startsWith(`/${this.bucketName}/`)
        ? objectPath.substring(this.bucketName.length + 2)
        : objectPath.substring(1);

      await this.minioClient.removeObject(this.bucketName, objectName);
      this.logger.log(`File deleted successfully: ${objectName}`);
    } catch (error) {
      this.logger.error(`Error deleting file: ${error.message}`, error.stack);
      throw error;
    }
  }

  // Get the MinIO endpoint for URL checking
  getMinioEndpoint(): string {
    return this.minioHost;
  }
}
