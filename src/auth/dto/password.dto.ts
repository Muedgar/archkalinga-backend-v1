import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';
import { WEAK_PASSWORD } from '../messages';
import { Match } from '../decorators';

export class RequestResetPasswordDto {
  @ApiProperty()
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @Matches(/^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$%^&*-]).+$/, {
    message: WEAK_PASSWORD,
  })
  @IsNotEmpty()
  @IsString()
  password: string;

  @ApiProperty()
  @Match('password', { message: 'Passwords do not match' })
  @IsNotEmpty()
  @IsString()
  confirmPassword: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  currentPassword: string;

  @ApiProperty()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @Matches(/^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$%^&*-]).+$/, {
    message: WEAK_PASSWORD,
  })
  @IsNotEmpty()
  @IsString()
  newPassword: string;

  @ApiProperty()
  @Match('newPassword', { message: 'Passwords do not match' })
  @IsNotEmpty()
  @IsString()
  confirmPassword: string;
}
