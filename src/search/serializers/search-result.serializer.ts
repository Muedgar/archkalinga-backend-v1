import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { SearchResultType } from '../dtos/search-query.dto';

export class SearchResultItemSerializer {
  @ApiProperty()
  id: string;

  @ApiProperty({
    enum: ['project', 'task', 'template', 'user', 'document', 'change_request'],
  })
  type: SearchResultType;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  subtitle?: string;

  @ApiPropertyOptional()
  snippet?: string;

  @ApiProperty()
  href: string;

  @ApiPropertyOptional()
  projectId?: string;

  @ApiPropertyOptional()
  icon?: string;

  @ApiPropertyOptional()
  score?: number;

  @ApiPropertyOptional()
  updatedAt?: string;
}

export class SearchResponseSerializer {
  @ApiProperty({ type: [SearchResultItemSerializer] })
  items: SearchResultItemSerializer[];
}
