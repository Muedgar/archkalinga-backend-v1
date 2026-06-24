import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import ExcelJS from 'exceljs';
import { Brackets, Repository, SelectQueryBuilder } from 'typeorm';
import { FilterResponse } from 'src/common/interfaces';
import { MaterialsReportFiltersDto } from '../dtos';
import { TaskMaterial } from '../entities';
import {
  MaterialReportSummaryLevel,
  TaskMaterialReportRowSerializer,
  TaskMaterialReportSummaryRowSerializer,
} from '../serializers';

type MaterialReportTotalRow = {
  level: MaterialReportSummaryLevel;
  phaseId: string | null;
  stageId: string | null;
  activityId: string | null;
  activityName: string | null;
  taskCode: string | null;
  taskName: string | null;
  materialCategory: string | null;
  totalMaterialCost: number;
  currency: string;
};

export type MaterialReportTotals = {
  currency: string;
  grandTotalMaterialCost: number;
  byPhase: MaterialReportTotalRow[];
  byStage: MaterialReportTotalRow[];
  byActivity: MaterialReportTotalRow[];
  byTask: MaterialReportTotalRow[];
  byMaterialCategory: MaterialReportTotalRow[];
};

export type MaterialReportResponse =
  FilterResponse<TaskMaterialReportRowSerializer> & {
    meta: {
      projectId: string;
      includeSummaryRows: boolean;
      orderedBy: 'phase-stage-activity-task-material';
    };
    totals: MaterialReportTotals;
    summaryRows: TaskMaterialReportSummaryRowSerializer[];
  };

@Injectable()
export class TaskMaterialsReportService {
  constructor(
    @InjectRepository(TaskMaterial)
    private readonly materialRepo: Repository<TaskMaterial>,
  ) {}

  async listProjectMaterialsReport(
    projectId: string,
    filters: MaterialsReportFiltersDto,
  ): Promise<MaterialReportResponse> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 100;
    const includeSummaryRows = filters.includeSummaryRows === true;
    const qb = this.buildProjectReportQuery(projectId, filters);

    qb.skip((page - 1) * limit).take(limit);

    const [rows, count] = await qb.getManyAndCount();
    const totals = await this.calculateTotals(projectId, filters);
    const summaryRows = includeSummaryRows
      ? this.serializeSummaryRows([
          ...totals.byTask,
          ...totals.byActivity,
          ...totals.byStage,
          ...totals.byPhase,
          ...totals.byMaterialCategory,
          {
            level: 'grand',
            phaseId: null,
            stageId: null,
            activityId: null,
            activityName: null,
            taskCode: null,
            taskName: null,
            materialCategory: null,
            totalMaterialCost: totals.grandTotalMaterialCost,
            currency: totals.currency,
          },
        ])
      : [];

    return {
      items: rows.map((row) => this.serialize(row)),
      meta: {
        projectId,
        includeSummaryRows,
        orderedBy: 'phase-stage-activity-task-material',
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

  async exportProjectMaterialsReportWorkbook(
    projectId: string,
    filters: MaterialsReportFiltersDto,
  ): Promise<Buffer> {
    const rows = await this.buildProjectReportQuery(projectId, filters).getMany();
    const totals = await this.calculateTotals(projectId, filters);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Archkalinga';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Materials Report', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    worksheet.columns = [
      { header: 'Phase ID', key: 'phaseId', width: 14 },
      { header: 'Stage ID', key: 'stageId', width: 14 },
      { header: 'Activity ID', key: 'activityId', width: 16 },
      { header: 'Activity Name', key: 'activityName', width: 30 },
      { header: 'Task ID', key: 'taskCode', width: 16 },
      { header: 'Task Name', key: 'taskName', width: 34 },
      { header: 'Material Category', key: 'materialCategory', width: 24 },
      { header: 'Material Name', key: 'materialName', width: 28 },
      { header: 'Unit', key: 'unit', width: 10 },
      { header: 'Qty', key: 'quantity', width: 12 },
      { header: 'Default Rate', key: 'defaultRate', width: 16 },
      { header: 'Waste %', key: 'wastePercent', width: 12 },
      { header: 'Material Cost (RWF)', key: 'materialCost', width: 20 },
      { header: 'Lookup Status', key: 'lookupStatus', width: 16 },
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
        stageId: row.stageCode ?? '',
        activityId: row.activityCode ?? '',
        activityName: row.activityName ?? '',
        taskCode: row.taskCode ?? '',
        taskName: row.taskName ?? '',
        materialCategory: row.materialCategory,
        materialName: row.materialName,
        unit: row.unit ?? '',
        quantity: row.quantity,
        defaultRate: row.defaultRate,
        wastePercent: row.wastePercent,
        materialCost: row.materialCost,
        lookupStatus: row.lookupStatus ?? '',
      });
    }

    if (filters.includeSummaryRows === true) {
      this.appendSummaryRows(worksheet, [
        ...totals.byTask,
        ...totals.byActivity,
        ...totals.byStage,
        ...totals.byPhase,
        ...totals.byMaterialCategory,
        {
          level: 'grand',
          phaseId: null,
          stageId: null,
          activityId: null,
          activityName: null,
          taskCode: null,
          taskName: null,
          materialCategory: null,
          totalMaterialCost: totals.grandTotalMaterialCost,
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
    filters: MaterialsReportFiltersDto,
  ): SelectQueryBuilder<TaskMaterial> {
    const qb = this.materialRepo
      .createQueryBuilder('material')
      .innerJoin('material.task', 'task')
      .where('task.projectId = :projectId', { projectId })
      .andWhere('task.deletedAt IS NULL');

    if (filters.taskId) {
      qb.andWhere('material.taskId = :taskId', { taskId: filters.taskId });
    }

    if (filters.phaseCode) {
      qb.andWhere('material.phaseCode = :phaseCode', {
        phaseCode: filters.phaseCode,
      });
    }

    if (filters.stageCode) {
      qb.andWhere('material.stageCode = :stageCode', {
        stageCode: filters.stageCode,
      });
    }

    if (filters.activityCode) {
      qb.andWhere('material.activityCode = :activityCode', {
        activityCode: filters.activityCode,
      });
    }

    if (filters.taskCode) {
      qb.andWhere('material.taskCode = :taskCode', {
        taskCode: filters.taskCode,
      });
    }

    if (filters.materialCategory) {
      qb.andWhere('material.materialCategory = :materialCategory', {
        materialCategory: filters.materialCategory,
      });
    }

    if (filters.materialName) {
      qb.andWhere('material.materialName ILIKE :materialName', {
        materialName: `%${filters.materialName}%`,
      });
    }

    if (filters.lookupStatus) {
      qb.andWhere('material.lookupStatus = :lookupStatus', {
        lookupStatus: filters.lookupStatus,
      });
    }

    if (filters.search) {
      qb.andWhere(
        new Brackets((searchQb) => {
          searchQb
            .where('material.phaseCode ILIKE :search')
            .orWhere('material.stageCode ILIKE :search')
            .orWhere('material.activityCode ILIKE :search')
            .orWhere('material.activityName ILIKE :search')
            .orWhere('material.taskCode ILIKE :search')
            .orWhere('material.taskName ILIKE :search')
            .orWhere('material.materialCategory ILIKE :search')
            .orWhere('material.materialName ILIKE :search')
            .orWhere('material.lookupStatus ILIKE :search');
        }),
        { search: `%${filters.search}%` },
      );
    }

    return qb
      .orderBy('material.phaseCode', 'ASC', 'NULLS LAST')
      .addOrderBy('material.stageCode', 'ASC', 'NULLS LAST')
      .addOrderBy('material.activityCode', 'ASC', 'NULLS LAST')
      .addOrderBy('material.taskCode', 'ASC', 'NULLS LAST')
      .addOrderBy('material.materialCategory', 'ASC')
      .addOrderBy('material.materialName', 'ASC')
      .addOrderBy('material.createdAt', 'ASC');
  }

  private async calculateTotals(
    projectId: string,
    filters: MaterialsReportFiltersDto,
  ): Promise<MaterialReportTotals> {
    const baseQb = this.buildProjectReportQuery(projectId, filters);
    const [
      grandRows,
      phaseRows,
      stageRows,
      activityRows,
      taskRows,
      materialCategoryRows,
    ] = await Promise.all([
      this.getGroupedTotals(baseQb, 'grand'),
      this.getGroupedTotals(baseQb, 'phase'),
      this.getGroupedTotals(baseQb, 'stage'),
      this.getGroupedTotals(baseQb, 'activity'),
      this.getGroupedTotals(baseQb, 'task'),
      this.getGroupedTotals(baseQb, 'materialCategory'),
    ]);
    const currency = grandRows[0]?.currency ?? 'RWF';

    return {
      currency,
      grandTotalMaterialCost: grandRows[0]?.totalMaterialCost ?? 0,
      byPhase: phaseRows,
      byStage: stageRows,
      byActivity: activityRows,
      byTask: taskRows,
      byMaterialCategory: materialCategoryRows,
    };
  }

  private async getGroupedTotals(
    qb: SelectQueryBuilder<TaskMaterial>,
    level: MaterialReportSummaryLevel,
  ): Promise<MaterialReportTotalRow[]> {
    const totalQb = qb.clone();

    totalQb
      .select('COALESCE(SUM(material.materialCost), 0)', 'totalMaterialCost')
      .addSelect('COALESCE(MAX(material.currency), :defaultCurrency)', 'currency')
      .setParameter('defaultCurrency', 'RWF')
      .orderBy();

    if (['phase', 'stage', 'activity', 'task'].includes(level)) {
      totalQb
        .addSelect('material.phaseCode', 'phaseId')
        .addGroupBy('material.phaseCode')
        .addOrderBy('material.phaseCode', 'ASC', 'NULLS LAST');
    }

    if (['stage', 'activity', 'task'].includes(level)) {
      totalQb
        .addSelect('material.stageCode', 'stageId')
        .addGroupBy('material.stageCode')
        .addOrderBy('material.stageCode', 'ASC', 'NULLS LAST');
    }

    if (['activity', 'task'].includes(level)) {
      totalQb
        .addSelect('material.activityCode', 'activityId')
        .addSelect('material.activityName', 'activityName')
        .addGroupBy('material.activityCode')
        .addGroupBy('material.activityName')
        .addOrderBy('material.activityCode', 'ASC', 'NULLS LAST');
    }

    if (level === 'task') {
      totalQb
        .addSelect('material.taskCode', 'taskCode')
        .addSelect('material.taskName', 'taskName')
        .addGroupBy('material.taskCode')
        .addGroupBy('material.taskName')
        .addOrderBy('material.taskCode', 'ASC', 'NULLS LAST');
    }

    if (level === 'materialCategory') {
      totalQb
        .addSelect('material.materialCategory', 'materialCategory')
        .addGroupBy('material.materialCategory')
        .addOrderBy('material.materialCategory', 'ASC');
    }

    const rows = await totalQb.getRawMany<{
      phaseId?: string | null;
      stageId?: string | null;
      activityId?: string | null;
      activityName?: string | null;
      taskCode?: string | null;
      taskName?: string | null;
      materialCategory?: string | null;
      totalMaterialCost: string | number | null;
      currency: string | null;
    }>();

    return rows.map((row) => ({
      level,
      phaseId: row.phaseId ?? null,
      stageId: row.stageId ?? null,
      activityId: row.activityId ?? null,
      activityName: row.activityName ?? null,
      taskCode: row.taskCode ?? null,
      taskName: row.taskName ?? null,
      materialCategory: row.materialCategory ?? null,
      totalMaterialCost:
        row.totalMaterialCost === null ? 0 : Number(row.totalMaterialCost),
      currency: row.currency ?? 'RWF',
    }));
  }

  private serialize(material: TaskMaterial): TaskMaterialReportRowSerializer {
    return plainToInstance(TaskMaterialReportRowSerializer, material, {
      excludeExtraneousValues: true,
    });
  }

  private serializeSummaryRows(
    rows: MaterialReportTotalRow[],
  ): TaskMaterialReportSummaryRowSerializer[] {
    return plainToInstance(TaskMaterialReportSummaryRowSerializer, rows, {
      excludeExtraneousValues: true,
    });
  }

  private appendSummaryRows(
    worksheet: ExcelJS.Worksheet,
    rows: MaterialReportTotalRow[],
  ) {
    if (rows.length === 0) return;

    worksheet.addRow({});
    const heading = worksheet.addRow({ activityName: 'Summary' });
    heading.font = { bold: true };

    for (const row of rows) {
      const label =
        row.level === 'grand'
          ? 'Grand Total'
          : `${this.formatLevel(row.level)} Total`;
      const summaryRow = worksheet.addRow({
        phaseId: row.phaseId ?? '',
        stageId: row.stageId ?? '',
        activityId: row.activityId ?? '',
        activityName: row.activityName ?? '',
        taskCode: row.taskCode ?? '',
        taskName: row.taskName ?? '',
        materialCategory: row.materialCategory ?? label,
        materialCost: row.totalMaterialCost,
      });
      summaryRow.font = { bold: true };
    }
  }

  private formatWorksheet(worksheet: ExcelJS.Worksheet) {
    const numericColumns = ['J', 'L'];
    const currencyColumns = ['K', 'M'];

    for (const column of numericColumns) {
      worksheet.getColumn(column).numFmt = '#,##0.00';
    }

    for (const column of currencyColumns) {
      worksheet.getColumn(column).numFmt = '#,##0';
    }
  }

  private formatLevel(level: MaterialReportSummaryLevel): string {
    if (level === 'materialCategory') return 'Material Category';
    return level.charAt(0).toUpperCase() + level.slice(1);
  }
}
