import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards';
import { GetUser } from 'src/auth/decorators';
import { ResponseMessage } from 'src/common/decorators';
import { User } from './entities';
import { MeService } from './me.service';
import { ME_FETCHED } from './messages';

@Controller('me')
@ApiTags('Me')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get()
  @ApiOperation({
    summary: "Get the authenticated user's full profile with org and role",
  })
  @ApiResponse({
    status: 200,
    description: 'User object including organization and permission matrix',
  })
  @ApiResponse({ status: 401, description: 'Invalid or missing access token' })
  @ResponseMessage(ME_FETCHED)
  getMe(@GetUser() user: User) {
    return this.meService.getMe(user.id);
  }

  @Get('profile')
  @ApiOperation({
    summary:
      "Get the authenticated user's extended profile (profession, bio, etc.)",
  })
  @ApiResponse({ status: 200, description: 'UserProfile record' })
  @ApiResponse({ status: 401, description: 'Invalid or missing access token' })
  @ResponseMessage('Profile fetched')
  getProfile(@GetUser() user: User) {
    return this.meService.getMyProfile(user.id);
  }
}
