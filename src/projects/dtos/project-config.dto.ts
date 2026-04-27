import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { StatusCategory } from 'src/tasks/project-config';

// ── Shared validators ─────────────────────────────────────────────────────────

const KEY_REGEX = /^[a-z0-9_]+$/;
const KEY_MESSAGE = 'key must contain only lowercase letters, digits, or underscores';

// ── Status DTOs ───────────────────────────────────────────────────────────────

export class CreateProjectStatusDto {
  @ApiProperty({ example: 'In Progress' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'in_progress' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(KEY_REGEX, { message: KEY_MESSAGE })
  key: string;

  @ApiPropertyOptional({ example: '#3B82F6', default: '#6B7280' })
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiPropertyOptional({ example: 1, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;

  @ApiPropertyOptional({ example: 5, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  wipLimit?: number | null;

  @ApiPropertyOptional({ enum: StatusCategory, default: StatusCategory.IN_PROGRESS })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsIn(Object.values(StatusCategory))
  category?: StatusCategory;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isTerminal?: boolean;
}

export class UpdateProjectStatusDto {
  @ApiPropertyOptional({ example: 'In Progress' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: '#3B82F6' })
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  wipLimit?: number | null;

  @ApiPropertyOptional({ enum: StatusCategory })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsIn(Object.values(StatusCategory))
  category?: StatusCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isTerminal?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── Priority DTOs ─────────────────────────────────────────────────────────────

export class CreateProjectPriorityDto {
  @ApiProperty({ example: 'High' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'high' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(KEY_REGEX, { message: KEY_MESSAGE })
  key: string;

  @ApiPropertyOptional({ example: '#EF4444', default: '#6B7280' })
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateProjectPriorityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── Severity DTOs ─────────────────────────────────────────────────────────────

export class CreateProjectSeverityDto {
  @ApiProperty({ example: 'Critical' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'critical' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(KEY_REGEX, { message: KEY_MESSAGE })
  key: string;

  @ApiPropertyOptional({ example: '#DC2626', default: '#6B7280' })
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateProjectSeverityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── Task Type DTOs ────────────────────────────────────────────────────────────

export class CreateProjectTaskTypeDto {
  @ApiProperty({ example: 'Bug' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'bug' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(KEY_REGEX, { message: KEY_MESSAGE })
  key: string;

  @ApiPropertyOptional({ example: 'bug-ant', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string | null;

  @ApiPropertyOptional({ example: '#EF4444', default: '#6B7280' })
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isSubtaskType?: boolean;
}

export class UpdateProjectTaskTypeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isSubtaskType?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── Label DTOs ────────────────────────────────────────────────────────────────

export class CreateProjectLabelDto {
  @ApiProperty({ example: 'Frontend' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'frontend' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(KEY_REGEX, { message: KEY_MESSAGE })
  key: string;

  @ApiPropertyOptional({ example: '#3B82F6', default: '#6B7280' })
  @IsOptional()
  @IsHexColor()
  color?: string;
}

export class UpdateProjectLabelDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── Reorder DTO (shared) ──────────────────────────────────────────────────────

export class ReorderConfigItemDto {
  @ApiProperty({ example: 2, description: 'New orderIndex value' })
  @IsInt()
  @Min(0)
  @Max(999)
  orderIndex: number;
}
