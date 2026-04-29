import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ReauthDto {
  @ApiProperty({
    description:
      'Current password to verify identity before a sensitive action',
    example: 'MyP@ssw0rd!',
  })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;
}
