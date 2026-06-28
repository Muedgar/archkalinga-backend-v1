import { Expose, Transform } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

export type MaterialReportSummaryLevel =
  | 'task'
  | 'activity'
  | 'stage'
  | 'phase'
  | 'materialCategory'
  | 'grand';

export class TaskMaterialReportRowSerializer extends BaseSerializer {
  @Expose()
  @Transform(({ obj }) => obj?.phaseCode ?? null)
  phaseId: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.stageCode ?? null)
  stageId: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.activityCode ?? null)
  activityId: string | null;

  @Expose() activityName: string | null;
  @Expose() taskCode: string | null;
  @Expose() taskName: string | null;
  @Expose() materialCategory: string;
  @Expose() materialName: string;
  @Expose() unit: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.quantity ?? null)
  quantity: number | null;

  @Expose() defaultRate: number | null;
  @Expose() wastePercent: number | null;
  @Expose() materialCost: number | null;
  @Expose() currency: string;
  @Expose() lookupStatus: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.taskId ?? null)
  taskId: string | null;
}

export class TaskMaterialReportSummaryRowSerializer {
  @Expose() level: MaterialReportSummaryLevel;
  @Expose() phaseId: string | null;
  @Expose() stageId: string | null;
  @Expose() activityId: string | null;
  @Expose() activityName: string | null;
  @Expose() taskCode: string | null;
  @Expose() taskName: string | null;
  @Expose() materialCategory: string | null;
  @Expose() totalMaterialCost: number;
  @Expose() currency: string;
}
