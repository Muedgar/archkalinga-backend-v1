import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsPositive } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ListNotificationsDto {
  @ApiProperty({ default: 1, required: false })
  @Transform(({ value }) => Math.max(Number(value), 1))
  @IsPositive()
  @IsInt()
  @IsOptional()
  page: number = 1;

  @ApiProperty({ default: 20, required: false })
  @Transform(({ value }) => Math.min(Math.max(Number(value), 1), 100))
  @IsPositive()
  @IsInt()
  @IsOptional()
  limit: number = 20;

  /** When provided, filters to only read (true) or unread (false) notifications. */
  @ApiProperty({ required: false, type: Boolean })
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
  })
  @IsBoolean()
  @IsOptional()
  isRead?: boolean;
}
