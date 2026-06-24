import { Expose, Transform } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

export class TaskMaterialSerializer extends BaseSerializer {
  @Expose()
  @Transform(({ obj }) => obj?.taskId ?? null)
  taskId: string | null;

  @Expose() phaseCode: string | null;
  @Expose() stageCode: string | null;
  @Expose() activityCode: string | null;
  @Expose() activityName: string | null;
  @Expose() taskCode: string | null;
  @Expose() taskName: string | null;
  @Expose() materialCategory: string;
  @Expose() materialName: string;
  @Expose() unit: string | null;
  @Expose() quantity: number;
  @Expose() defaultRate: number | null;
  @Expose() wastePercent: number | null;
  @Expose() materialCost: number | null;
  @Expose() currency: string;
  @Expose() lookupStatus: string | null;
}
