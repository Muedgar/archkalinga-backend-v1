import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AddWatcherDto {
  @ApiProperty({ example: 'a1b2c3d4-...', description: 'User UUID to add as watcher' })
  @IsUUID()
  userId: string;
}
