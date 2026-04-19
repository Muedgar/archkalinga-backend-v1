import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AddLabelDto {
  @ApiProperty({ example: 'a1b2c3d4-...', description: 'ProjectLabel UUID' })
  @IsUUID()
  labelId: string;
}
