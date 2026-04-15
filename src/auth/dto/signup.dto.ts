import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsStrongPassword,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

function trimToUndefined({ value }: { value: unknown }) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export class SignupDto {
  // ── User fields ───────────────────────────────────────────────────────────────

  @ApiProperty({ example: 'John' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: 'jdoe' })
  @IsString()
  @IsNotEmpty()
  userName: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Secret123!' })
  @IsStrongPassword({ minLength: 8 })
  password: string;

  @ApiPropertyOptional({ example: 'Senior Architect' })
  @IsOptional()
  @IsString()
  @Transform(trimToUndefined)
  title?: string;

  // ── Workspace fields ──────────────────────────────────────────────────────────

  @ApiProperty({ example: 'Acme Studio' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  workspaceName: string;

  @ApiPropertyOptional({ example: 'Architecture and design firm based in Kigali' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trimToUndefined)
  workspaceDescription?: string;
}
