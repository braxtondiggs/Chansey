import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Client as MinioClient } from 'minio';
import { InjectMinio } from 'nestjs-minio';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucketName: string;
  private readonly bucketRegion: string;
  private readonly minioHost: string;
  private readonly minioPort: number;
  private readonly minioUseSSL: boolean;

  constructor(
    @InjectMinio() private readonly minioClient: MinioClient,
    private readonly configService: ConfigService
  ) {
    // Read MinIO configuration from environment variables
    this.minioHost = this.configService.get<string>('MINIO_HOST');
    this.minioPort = parseInt(this.configService.get<string>('MINIO_PORT'), 10);
    this.bucketName = this.configService.get<string>('MINIO_BUCKET_NAME');
    this.bucketRegion = this.configService.get<string>('MINIO_BUCKET_REGION');
    this.minioUseSSL = this.configService.get<string>('MINIO_USE_SSL') === 'true';
  }

  async onModuleInit() {
    await this.checkAndCreateBucket();
  }

  // Check if the bucket exists, if not create it
  private async checkAndCreateBucket(): Promise<void> {
    try {
      const exists = await this.minioClient.bucketExists(this.bucketName);
      if (!exists) {
        await this.minioClient.makeBucket(this.bucketName, this.bucketRegion);
        this.logger.log(`Bucket '${this.bucketName}' created successfully`);

        // Set the bucket policy to allow public read access if needed
        const policy = {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${this.bucketName}/*`]
            }
          ]
        };
        await this.minioClient.setBucketPolicy(this.bucketName, JSON.stringify(policy));
        this.logger.log(`Bucket '${this.bucketName}' policy set to public read`);
      } else {
        this.logger.log(`Bucket '${this.bucketName}' already exists`);
      }
    } catch (error) {
      this.logger.error(`Error checking/creating bucket: ${error.message}`, error.stack);
    }
  }

  // Upload a file to MinIO
  async uploadFile(file: Buffer, contentType: string, fileName: string, folder = 'profile-images'): Promise<string> {
    try {
      const objectName = `${folder}/${Date.now()}-${fileName}`;

      await this.minioClient.putObject(this.bucketName, objectName, file, undefined, { 'Content-Type': contentType });

      // Construct the public URL to the uploaded file
      const baseUrl = this.minioUseSSL
        ? `https://${this.minioHost}:${this.minioPort}`
        : `http://${this.minioHost}:${this.minioPort}`;

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
