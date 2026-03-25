/* eslint-disable @typescript-eslint/no-unsafe-call */
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsPositive } from 'class-validator';

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export class ListFilterDTO {
  @ApiProperty({ default: 1 })
  @Transform(({ value }) => Math.max(Number(value), 1))
  @IsPositive()
  @IsInt()
  @IsOptional()
  page: number = 1;

  @ApiProperty({ default: 10 })
  @Transform(({ value }) => Math.max(Number(value), 1))
  @IsPositive()
  @IsInt()
  @IsOptional()
  limit: number = 10;

  @ApiProperty({ required: false })
  @IsOptional()
  orderBy?: string = 'createdAt';

  @ApiProperty({ required: false })
  @IsEnum(SortOrder)
  @IsOptional()
  sortOrder?: SortOrder = SortOrder.DESC;

  @ApiProperty({ required: false })
  @IsOptional()
  search?: string;
}
