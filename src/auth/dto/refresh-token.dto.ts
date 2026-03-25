import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Raw refresh token returned at login/OTP validation' })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
