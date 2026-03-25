import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsStrongPassword,
  IsUrl,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { UserType } from 'src/users/entities/user.entity';

function trimToUndefined({ value }: { value: unknown }) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export class SignupDto {
  @ApiProperty({ enum: UserType, example: UserType.INDIVIDUAL })
  @IsEnum(UserType)
  userType: UserType;

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

  // ── Profile fields (INDIVIDUAL) ──────────────────────────────────────────
  @ApiPropertyOptional({ example: 'Architecture' })
  @IsOptional()
  @IsString()
  @Transform(trimToUndefined)
  profession?: string;

  @ApiPropertyOptional({ example: 'Interior Design' })
  @IsOptional()
  @IsString()
  @Transform(trimToUndefined)
  specialty?: string;

  // ── Organization fields (required when userType = ORGANIZATION) ───────────
  @ApiPropertyOptional({ example: 'Acme Studio' })
  @ValidateIf((o: SignupDto) => o.userType === UserType.ORGANIZATION)
  @IsString()
  @IsNotEmpty()
  @Transform(trimToUndefined)
  organizationName?: string;

  @ApiPropertyOptional({ example: 'Kigali Heights' })
  @IsOptional()
  @IsString()
  @Transform(trimToUndefined)
  organizationAddress?: string;

  @ApiPropertyOptional({ example: 'Kigali' })
  @IsOptional()
  @IsString()
  @Transform(trimToUndefined)
  organizationCity?: string;

  @ApiPropertyOptional({ example: 'Rwanda' })
  @IsOptional()
  @IsString()
  @Transform(trimToUndefined)
  organizationCountry?: string;

  @ApiPropertyOptional({ example: 'https://acmestudio.com' })
  @IsOptional()
  @IsUrl()
  @Transform(trimToUndefined)
  organizationWebsite?: string;
}
