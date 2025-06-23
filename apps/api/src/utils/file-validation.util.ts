import { BadRequestException } from '@nestjs/common';

import { MultipartFile } from '@fastify/multipart';

export interface FileValidationOptions {
  allowedMimeTypes: string[];
  allowedExtensions: string[];
  maxFilenameLength?: number;
}

export const validateImageFile = (file: MultipartFile): void => {
  const options: FileValidationOptions = {
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    maxFilenameLength: 100
  };

  validateFile(file, options);
};

export const validateFile = (file: MultipartFile, options: FileValidationOptions): void => {
  // Validate MIME type
  if (!options.allowedMimeTypes.includes(file.mimetype)) {
    throw new BadRequestException(
      `File type not allowed: ${file.mimetype}. Allowed types: ${options.allowedMimeTypes.join(', ')}`
    );
  }

  // Validate file extension
  const filename = file.filename?.toLowerCase();
  if (!filename) {
    throw new BadRequestException('Filename is required');
  }

  const hasValidExtension = options.allowedExtensions.some((ext) => filename.endsWith(ext));
  if (!hasValidExtension) {
    throw new BadRequestException(
      `File extension not allowed: ${filename}. Allowed extensions: ${options.allowedExtensions.join(', ')}`
    );
  }

  // Prevent path traversal attacks
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new BadRequestException('Invalid filename: contains path traversal characters');
  }

  // Validate filename length
  const maxLength = options.maxFilenameLength || 255;
  if (filename.length > maxLength) {
    throw new BadRequestException(`Filename too long: maximum ${maxLength} characters allowed`);
  }

  // Additional security: check for null bytes
  if (filename.includes('\0')) {
    throw new BadRequestException('Invalid filename: contains null bytes');
  }
};
