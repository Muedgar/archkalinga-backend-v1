import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsStrongPassword,
  IsUUID,
} from 'class-validator';

/** DTO used by admins to create a new collaborator within their organization. */
export class CreateUserDTO {
  @ApiProperty({ example: 'John' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: 'jdoe.arch' })
  @IsString()
  @IsNotEmpty()
  userName: string;

  @ApiProperty({ example: 'john@company.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: 'Senior Architect' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  status: boolean;

  @ApiProperty({ example: 'Secret123!' })
  @IsStrongPassword({ minLength: 8 })
  password: string;

  @ApiProperty({ description: 'UUID of the workspace role to assign' })
  @IsUUID('4')
  roleId: string;
}
