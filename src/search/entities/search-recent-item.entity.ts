import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import type { SearchResultType } from '../dtos';

@Entity('search_recent_items')
@Unique(['workspaceId', 'userId', 'type', 'resourceId'])
@Index(['workspaceId', 'userId', 'openedAt'])
export class SearchRecentItem extends AppBaseEntity {
  @Column({ type: 'uuid', nullable: false })
  workspaceId: string;

  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @Column({ type: 'varchar', length: 40, nullable: false })
  type: SearchResultType;

  @Column({ type: 'uuid', nullable: false })
  resourceId: string;

  @Column({ type: 'timestamptz', nullable: false })
  openedAt: Date;
}
