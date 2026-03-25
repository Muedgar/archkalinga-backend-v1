import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength, MinLength } from 'class-validator';

export class OtpDTO {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @MinLength(6, { message: 'OTP must be at least 6 characters' })
  @MaxLength(6, { message: 'OTP must be at most 6 characters' })
  otp: string;
}
