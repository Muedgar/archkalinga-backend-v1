import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import ExcelJS from 'exceljs';
import { Brackets, Repository, SelectQueryBuilder } from 'typeorm';
import { FilterResponse } from 'src/common/interfaces';
import { ResourceReportFiltersDto } from '../dtos';
import { TaskResourceAllocation } from '../entities';
import {
  TaskResourceReportRowSerializer,
  TaskResourceReportSummaryRowSerializer,
} from '../serializers';

type ResourceReportSummaryLevel = 'activity' | 'stage' | 'phase' | 'grand';

type ResourceReportTotalRow = {
  level: ResourceReportSummaryLevel;
  phaseId: string | null;
  phaseName: string | null;
  stageId: string | null;
  stageName: string | null;
  activityId: string | null;
  activityName: string | null;
  totalCostAmount: number;
  currency: string;
};

export type ResourceReportTotals = {
  currency: string;
  grandTotalCostAmount: number;
  byPhase: ResourceReportTotalRow[];
  byStage: ResourceReportTotalRow[];
  byActivity: ResourceReportTotalRow[];
};

export type ResourceReportResponse =
  FilterResponse<TaskResourceReportRowSerializer> & {
    meta: {
      projectId: string;
      includeSummaryRows: boolean;
      orderedBy: 'phase-stage-activity-resource';
    };
    totals: ResourceReportTotals;
    summaryRows: TaskResourceReportSummaryRowSerializer[];
  };

@Injectable()
export class TaskResourceReportService {
  constructor(
    @InjectRepository(TaskResourceAllocation)
    private readonly allocationRepo: Repository<TaskResourceAllocation>,
  ) {}

  async listProjectResourceReport(
    projectId: string,
    filters: ResourceReportFiltersDto,
  ): Promise<ResourceReportResponse> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 100;
    const includeSummaryRows = filters.includeSummaryRows === true;
    const qb = this.buildProjectReportQuery(projectId, filters);

    qb.skip((page - 1) * limit).take(limit);

    const [rows, count] = await qb.getManyAndCount();
    const totals = await this.calculateTotals(projectId, filters);
    const summaryRows = includeSummaryRows
      ? this.serializeSummaryRows([
          ...totals.byActivity,
          ...totals.byStage,
          ...totals.byPhase,
          {
            level: 'grand',
            phaseId: null,
            phaseName: null,
            stageId: null,
            stageName: null,
            activityId: null,
            activityName: null,
            totalCostAmount: totals.grandTotalCostAmount,
            currency: totals.currency,
          },
        ])
      : [];

    return {
      items: rows.map((row) => this.serialize(row)),
      meta: {
        projectId,
        includeSummaryRows,
        orderedBy: 'phase-stage-activity-resource',
      },
      totals,
      summaryRows,
      count,
      pages: Math.ceil(count / limit),
      previousPage: page > 1 ? page - 1 : null,
      page,
      nextPage: count / limit > page ? page + 1 : null,
      limit,
    };
  }

  async exportProjectResourceReportWorkbook(
    projectId: string,
    filters: ResourceReportFiltersDto,
  ): Promise<Buffer> {
    const rows = await this.buildProjectReportQuery(projectId, filters).getMany();
    const totals = await this.calculateTotals(projectId, filters);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Archkalinga';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Resource Report', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    worksheet.columns = [
      { header: 'Phase ID', key: 'phaseId', width: 14 },
      { header: 'Phase Name', key: 'phaseName', width: 28 },
      { header: 'Stage ID', key: 'stageId', width: 14 },
      { header: 'Stage Name', key: 'stageName', width: 28 },
      { header: 'Activity ID', key: 'activityId', width: 16 },
      { header: 'Activity Name', key: 'activityName', width: 30 },
      { header: 'Resource Type', key: 'resourceType', width: 18 },
      { header: 'Resource Name', key: 'resourceName', width: 24 },
      { header: 'Qty', key: 'quantity', width: 10 },
      { header: 'Duration (days)', key: 'durationDays', width: 16 },
      { header: 'Default Rate', key: 'defaultRate', width: 16 },
      { header: 'Override Rate', key: 'overrideRate', width: 16 },
      { header: 'Effective Rate', key: 'effectiveRate', width: 16 },
      { header: 'Cost (RWF)', key: 'costAmount', width: 16 },
      { header: 'Status', key: 'status', width: 12 },
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: 'middle' };
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: worksheet.columns.length },
    };

    for (const row of rows) {
      worksheet.addRow({
        phaseId: row.phaseCode ?? '',
        phaseName: row.phaseName ?? '',
        stageId: row.stageCode ?? '',
        stageName: row.stageName ?? '',
        activityId: row.activityCode ?? '',
        activityName: row.activityName ?? '',
        resourceType: row.resourceType,
        resourceName: row.resourceName,
        quantity: row.quantity,
        durationDays: row.durationDays,
        defaultRate: row.defaultRate,
        overrideRate: row.overrideRate,
        effectiveRate: row.effectiveRate,
        costAmount: row.costAmount,
        status: row.status ?? '',
      });
    }

    if (filters.includeSummaryRows === true) {
      this.appendSummaryRows(worksheet, [
        ...totals.byActivity,
        ...totals.byStage,
        ...totals.byPhase,
        {
          level: 'grand',
          phaseId: null,
          phaseName: null,
          stageId: null,
          stageName: null,
          activityId: null,
          activityName: null,
          totalCostAmount: totals.grandTotalCostAmount,
          currency: totals.currency,
        },
      ]);
    }

    this.formatWorksheet(worksheet);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  buildProjectReportQuery(
    projectId: string,
    filters: ResourceReportFiltersDto,
  ): SelectQueryBuilder<TaskResourceAllocation> {
    const qb = this.allocationRepo
      .createQueryBuilder('allocation')
      .innerJoin('allocation.task', 'task')
      .where('task.projectId = :projectId', { projectId })
      .andWhere('task.deletedAt IS NULL');

    if (filters.taskId) {
      qb.andWhere('allocation.taskId = :taskId', { taskId: filters.taskId });
    }

    if (filters.phaseCode) {
      qb.andWhere('allocation.phaseCode = :phaseCode', {
        phaseCode: filters.phaseCode,
      });
    }

    if (filters.stageCode) {
      qb.andWhere('allocation.stageCode = :stageCode', {
        stageCode: filters.stageCode,
      });
    }

    if (filters.activityCode) {
      qb.andWhere('allocation.activityCode = :activityCode', {
        activityCode: filters.activityCode,
      });
    }

    if (filters.resourceType) {
      qb.andWhere('allocation.resourceType = :resourceType', {
        resourceType: filters.resourceType,
      });
    }

    if (filters.resourceName) {
      qb.andWhere('allocation.resourceName ILIKE :resourceName', {
        resourceName: `%${filters.resourceName}%`,
      });
    }

    if (filters.status) {
      qb.andWhere('allocation.status = :status', { status: filters.status });
    }

    if (filters.search) {
      qb.andWhere(
        new Brackets((searchQb) => {
          searchQb
            .where('allocation.phaseName ILIKE :search')
            .orWhere('allocation.stageName ILIKE :search')
            .orWhere('allocation.activityName ILIKE :search')
            .orWhere('allocation.resourceType ILIKE :search')
            .orWhere('allocation.resourceName ILIKE :search')
            .orWhere('allocation.phaseCode ILIKE :search')
            .orWhere('allocation.stageCode ILIKE :search')
            .orWhere('allocation.activityCode ILIKE :search');
        }),
        { search: `%${filters.search}%` },
      );
    }

    return qb
      .orderBy('allocation.phaseCode', 'ASC', 'NULLS LAST')
      .addOrderBy('allocation.stageCode', 'ASC', 'NULLS LAST')
      .addOrderBy('allocation.activityCode', 'ASC', 'NULLS LAST')
      .addOrderBy('allocation.resourceType', 'ASC')
      .addOrderBy('allocation.resourceName', 'ASC')
      .addOrderBy('allocation.createdAt', 'ASC');
  }

  private async calculateTotals(
    projectId: string,
    filters: ResourceReportFiltersDto,
  ): Promise<ResourceReportTotals> {
    const baseQb = this.buildProjectReportQuery(projectId, filters);
    const [grandRows, phaseRows, stageRows, activityRows] = await Promise.all([
      this.getGroupedTotals(baseQb, 'grand'),
      this.getGroupedTotals(baseQb, 'phase'),
      this.getGroupedTotals(baseQb, 'stage'),
      this.getGroupedTotals(baseQb, 'activity'),
    ]);
    const currency = grandRows[0]?.currency ?? 'RWF';

    return {
      currency,
      grandTotalCostAmount: grandRows[0]?.totalCostAmount ?? 0,
      byPhase: phaseRows,
      byStage: stageRows,
      byActivity: activityRows,
    };
  }

  private async getGroupedTotals(
    qb: SelectQueryBuilder<TaskResourceAllocation>,
    level: ResourceReportSummaryLevel,
  ): Promise<ResourceReportTotalRow[]> {
    const totalQb = qb.clone();

    totalQb
      .select('COALESCE(SUM(allocation.costAmount), 0)', 'totalCostAmount')
      .addSelect('COALESCE(MAX(allocation.currency), :defaultCurrency)', 'currency')
      .setParameter('defaultCurrency', 'RWF')
      .orderBy();

    if (level === 'phase' || level === 'stage' || level === 'activity') {
      totalQb
        .addSelect('allocation.phaseCode', 'phaseId')
        .addSelect('allocation.phaseName', 'phaseName')
        .addGroupBy('allocation.phaseCode')
        .addGroupBy('allocation.phaseName')
        .addOrderBy('allocation.phaseCode', 'ASC', 'NULLS LAST');
    }

    if (level === 'stage' || level === 'activity') {
      totalQb
        .addSelect('allocation.stageCode', 'stageId')
        .addSelect('allocation.stageName', 'stageName')
        .addGroupBy('allocation.stageCode')
        .addGroupBy('allocation.stageName')
        .addOrderBy('allocation.stageCode', 'ASC', 'NULLS LAST');
    }

    if (level === 'activity') {
      totalQb
        .addSelect('allocation.activityCode', 'activityId')
        .addSelect('allocation.activityName', 'activityName')
        .addGroupBy('allocation.activityCode')
        .addGroupBy('allocation.activityName')
        .addOrderBy('allocation.activityCode', 'ASC', 'NULLS LAST');
    }

    const rows = await totalQb.getRawMany<{
      phaseId?: string | null;
      phaseName?: string | null;
      stageId?: string | null;
      stageName?: string | null;
      activityId?: string | null;
      activityName?: string | null;
      totalCostAmount: string | number | null;
      currency: string | null;
    }>();

    return rows.map((row) => ({
      level,
      phaseId: row.phaseId ?? null,
      phaseName: row.phaseName ?? null,
      stageId: row.stageId ?? null,
      stageName: row.stageName ?? null,
      activityId: row.activityId ?? null,
      activityName: row.activityName ?? null,
      totalCostAmount:
        row.totalCostAmount === null ? 0 : Number(row.totalCostAmount),
      currency: row.currency ?? 'RWF',
    }));
  }

  private serialize(
    allocation: TaskResourceAllocation,
  ): TaskResourceReportRowSerializer {
    return plainToInstance(TaskResourceReportRowSerializer, allocation, {
      excludeExtraneousValues: true,
    });
  }

  private serializeSummaryRows(
    rows: ResourceReportTotalRow[],
  ): TaskResourceReportSummaryRowSerializer[] {
    return plainToInstance(TaskResourceReportSummaryRowSerializer, rows, {
      excludeExtraneousValues: true,
    });
  }

  private appendSummaryRows(
    worksheet: ExcelJS.Worksheet,
    rows: ResourceReportTotalRow[],
  ) {
    if (rows.length === 0) return;

    worksheet.addRow({});
    const heading = worksheet.addRow({ phaseName: 'Summary' });
    heading.font = { bold: true };

    for (const row of rows) {
      const label =
        row.level === 'grand'
          ? 'Grand Total'
          : `${this.capitalize(row.level)} Total`;
      const summaryRow = worksheet.addRow({
        phaseId: row.phaseId ?? '',
        phaseName: row.phaseName ?? label,
        stageId: row.stageId ?? '',
        stageName: row.stageName ?? '',
        activityId: row.activityId ?? '',
        activityName: row.activityName ?? '',
        resourceType: label,
        costAmount: row.totalCostAmount,
      });
      summaryRow.font = { bold: true };
    }
  }

  private formatWorksheet(worksheet: ExcelJS.Worksheet) {
    const numericColumns = ['I', 'J'];
    const currencyColumns = ['K', 'L', 'M', 'N'];

    for (const column of numericColumns) {
      worksheet.getColumn(column).numFmt = '#,##0.00';
    }

    for (const column of currencyColumns) {
      worksheet.getColumn(column).numFmt = '#,##0';
    }
  }

  private capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
}
