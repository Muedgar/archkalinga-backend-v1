import { Expose } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

export class WorkflowColumnSerializer extends BaseSerializer {
  @Expose() projectId: string;
  @Expose() name: string;
  @Expose() statusKey: string | null;
  @Expose() orderIndex: number;
  @Expose() wipLimit: number | null;
  @Expose() locked: boolean;
  @Expose() taskCount?: number;
  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}
