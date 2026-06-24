import { Expose, Transform } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

export type ResourceReportSummaryLevel = 'activity' | 'stage' | 'phase' | 'grand';

export class TaskResourceReportRowSerializer extends BaseSerializer {
  @Expose()
  @Transform(({ obj }) => obj?.phaseCode ?? null)
  phaseId: string | null;

  @Expose() phaseName: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.stageCode ?? null)
  stageId: string | null;

  @Expose() stageName: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.activityCode ?? null)
  activityId: string | null;

  @Expose() activityName: string | null;
  @Expose() resourceType: string;
  @Expose() resourceName: string;

  @Expose()
  @Transform(({ obj }) => obj?.quantity ?? null)
  quantity: number | null;

  @Expose() durationDays: number | null;
  @Expose() defaultRate: number | null;
  @Expose() overrideRate: number | null;
  @Expose() effectiveRate: number | null;
  @Expose() costAmount: number | null;
  @Expose() currency: string;
  @Expose() status: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.taskId ?? null)
  taskId: string | null;
}

export class TaskResourceReportSummaryRowSerializer {
  @Expose() level: ResourceReportSummaryLevel;
  @Expose() phaseId: string | null;
  @Expose() phaseName: string | null;
  @Expose() stageId: string | null;
  @Expose() stageName: string | null;
  @Expose() activityId: string | null;
  @Expose() activityName: string | null;
  @Expose() totalCostAmount: number;
  @Expose() currency: string;
}
