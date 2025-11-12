import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Get,
  HttpStatus,
  Logger,
  Patch,
  Post,
  Req,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { FastifyRequest } from 'fastify';

import { UpdateUserDto, UserResponseDto } from './dto';
import { User } from './users.entity';
import { UsersService } from './users.service';

import GetUser from '../authentication/decorator/get-user.decorator';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import { StorageService } from '../storage/storage.service';
import { UploadThrottle } from '../utils/decorators/throttle.decorator';
import { validateImageFile } from '../utils/file-validation.util';

@ApiTags('User')
@ApiBearerAuth('token')
@ApiResponse({
  status: HttpStatus.UNAUTHORIZED,
  description: 'Invalid credentials'
})
@Controller('user')
@UseGuards(JwtAuthenticationGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(
    private readonly user: UsersService,
    private readonly storage: StorageService
  ) {}

  @Patch()
  @ApiOperation({
    summary: 'Update user',
    description: "Updates the authenticated user's information."
  })
  @ApiOkResponse({
    description: 'The user has been successfully updated.',
    type: UserResponseDto
  })
  async updateUser(@Body() dto: UpdateUserDto, @GetUser() user: User) {
    return this.user.update(dto, user);
  }

  @Post('profile-image')
  @UploadThrottle()
  @ApiOperation({
    summary: 'Upload profile image',
    description: 'Uploads a profile image for the authenticated user.'
  })
  @ApiConsumes('multipart/form-data')
  @ApiOkResponse({
    description: 'The image has been successfully uploaded.',
    type: UserResponseDto
  })
  async uploadProfileImage(@Req() req: FastifyRequest, @GetUser() user: User) {
    try {
      // Process the multipart file with Fastify's multipart parser
      const data = await req.file();
      if (!data) {
        throw new Error('No file uploaded');
      }

      // Validate the uploaded file
      validateImageFile(data);

      const buffer = await data.toBuffer();
      const fileName = data.filename;
      const contentType = data.mimetype;

      // Upload to MinIO
      const fileUrl = await this.storage.uploadFile(buffer, contentType, fileName);

      // Delete old profile image if it exists and uses MinIO
      if (user.picture && user.picture.includes(this.storage.getMinioEndpoint())) {
        try {
          await this.storage.deleteFile(user.picture);
        } catch (error) {
          // Log but continue even if deletion fails
          this.logger.error(
            `Error deleting old profile image: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      // Update user profile with the new image URL
      return this.user.update({ picture: fileUrl }, user, true);
    } catch (error) {
      this.logger.error(`Error processing file upload: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  @Get()
  @ApiOperation({
    summary: 'Get user info with Authorizer profile',
    description: 'Retrieves information about the authenticated user, including Authorizer profile information.'
  })
  @ApiOkResponse({
    description: 'User information retrieved successfully.',
    type: UserResponseDto
  })
  async get(@GetUser() user: User) {
    // Get a fresh copy of the user profile from Authorizer
    try {
      // Get user with full Authorizer profile
      const userWithProfile = await this.user.getWithAuthorizerProfile(user);

      return userWithProfile;
    } catch (error) {
      this.logger.error(
        `Error fetching complete user profile: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      // Fall back to the basic user data if Authorizer fetch fails
      return user;
    }
  }
}
