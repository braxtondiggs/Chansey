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

import {
  AlgoTradingStatusDto,
  EnrollInAlgoTradingDto,
  UpdateAlgoCapitalDto,
  UpdateUserDto,
  UserResponseDto
} from './dto';
import { User } from './users.entity';
import { UsersService } from './users.service';

import GetUser from '../authentication/decorator/get-user.decorator';
import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';
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
        } catch (error: unknown) {
          // Log but continue even if deletion fails
          this.logger.error(
            `Error deleting old profile image: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      // Update user profile with the new image URL
      return this.user.update({ picture: fileUrl }, user);
    } catch (error: unknown) {
      this.logger.error(`Error processing file upload: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  @Get()
  @ApiOperation({
    summary: 'Get user profile',
    description: 'Retrieves information about the authenticated user.'
  })
  @ApiOkResponse({
    description: 'User information retrieved successfully.',
    type: UserResponseDto
  })
  async get(@GetUser() user: User) {
    try {
      return await this.user.getProfile(user);
    } catch (error: unknown) {
      this.logger.error(`Error fetching user profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
      // Fall back to the basic user data if fetch fails
      return user;
    }
  }

  @Post('algo-trading/enroll')
  @ApiOperation({
    summary: 'Enroll in algorithmic trading',
    description: 'Opt into the robo-advisor by allocating capital and selecting an exchange key.'
  })
  @ApiOkResponse({
    description: 'Successfully enrolled in algo trading.',
    type: UserResponseDto
  })
  async enrollInAlgoTrading(@Body() dto: EnrollInAlgoTradingDto, @GetUser() user: User) {
    return this.user.enrollInAlgoTrading(user.id, dto.capitalAllocationPercentage, dto.exchangeKeyId);
  }

  @Patch('algo-trading/pause')
  @ApiOperation({
    summary: 'Pause algorithmic trading',
    description: 'Temporarily disable algo trading. Existing positions remain open, but no new trades will be executed.'
  })
  @ApiOkResponse({
    description: 'Algo trading paused successfully.',
    type: UserResponseDto
  })
  async pauseAlgoTrading(@GetUser() user: User) {
    return this.user.pauseAlgoTrading(user.id);
  }

  @Patch('algo-trading/resume')
  @ApiOperation({
    summary: 'Resume algorithmic trading',
    description:
      'Re-enable algo trading after it was paused. Trading will resume with existing positions and capital allocation.'
  })
  @ApiOkResponse({
    description: 'Algo trading resumed successfully.',
    type: UserResponseDto
  })
  async resumeAlgoTrading(@GetUser() user: User) {
    return this.user.resumeAlgoTrading(user.id);
  }

  @Patch('algo-trading/update-capital')
  @ApiOperation({
    summary: 'Update capital allocation percentage',
    description: 'Adjust the percentage of free balance allocated to algorithmic trading.'
  })
  @ApiOkResponse({
    description: 'Capital allocation percentage updated successfully.',
    type: UserResponseDto
  })
  async updateAlgoCapital(@Body() dto: UpdateAlgoCapitalDto, @GetUser() user: User) {
    return this.user.updateAlgoCapital(user.id, dto.newPercentage);
  }

  @Get('algo-trading/status')
  @ApiOperation({
    summary: 'Get algo trading status',
    description: 'Retrieve current enrollment status, capital allocation, and active strategy count.'
  })
  @ApiOkResponse({
    description: 'Algo trading status retrieved successfully.',
    type: AlgoTradingStatusDto
  })
  async getAlgoTradingStatus(@GetUser() user: User) {
    return this.user.getAlgoTradingStatus(user.id);
  }
}
