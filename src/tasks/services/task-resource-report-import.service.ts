import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { In, IsNull, Repository } from 'typeorm';
import {
  ResourceReportImportDto,
  ResourceReportImportMode,
} from '../dtos';
import { Task, TaskResourceAllocation } from '../entities';
import type { ActivityScheduleUploadFile } from './activity-schedule-import.service';

type ImportIssueSeverity = 'error' | 'warning';

type ResourceImportIssue = {
  row: number | null;
  severity: ImportIssueSeverity;
  field: string;
  message: string;
  value?: string | number | null;
};

type ParsedResourceRow = {
  rowNumber: number;
  phaseCode: string | null;
  phaseName: string | null;
  stageCode: string | null;
  stageName: string | null;
  activityCode: string;
  activityName: string | null;
  resourceType: string;
  resourceName: string;
  quantity: number;
  durationDays: number | null;
  defaultRate: number | null;
  overrideRate: number | null;
  effectiveRate: number | null;
  costAmount: number | null;
  status: string | null;
};

type ResourceImportValidation = {
  mode: ResourceReportImportMode;
  valid: boolean;
  summary: {
    sheetName: string;
    parsedRows: number;
    importRows: number;
    matchedTaskCount: number;
    missingTaskCount: number;
    phaseCount: number;
    stageCount: number;
    activityCount: number;
    resourceTypeCount: number;
    totalCostAmount: number;
    errorCount: number;
    warningCount: number;
  };
  issues: ResourceImportIssue[];
  preview: Array<
    Pick<
      ParsedResourceRow,
      | 'rowNumber'
      | 'phaseCode'
      | 'stageCode'
      | 'activityCode'
      | 'resourceType'
      | 'resourceName'
      | 'quantity'
      | 'durationDays'
      | 'costAmount'
      | 'status'
    >
  >;
};

type ResourceImportResult = ResourceImportValidation & {
  upsert?: {
    deletedAllocations: number;
    insertedAllocations: number;
    matchedActivityCodes: number;
  };
};

@Injectable()
export class TaskResourceReportImportService {
  private static readonly REQUIRED_HEADERS = [
    'phaseid',
    'phasename',
    'stageid',
    'stagename',
    'activityid',
    'activityname',
    'resourcetype',
    'resourcename',
    'qty',
    'durationdays',
    'defaultrate',
    'effectiverate',
    'costrwf',
    'status',
  ];

  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(TaskResourceAllocation)
    private readonly allocationRepo: Repository<TaskResourceAllocation>,
  ) {}

  async importProjectResourceReport(
    projectId: string,
    file: ActivityScheduleUploadFile | undefined,
    dto: ResourceReportImportDto,
  ): Promise<ResourceImportResult> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Resource report Excel file is required');
    }

    const mode = dto.mode ?? ResourceReportImportMode.VALIDATE_ONLY;
    const parsed = await this.parseWorkbook(file.buffer);
    const validation = await this.validateRows(projectId, parsed, mode);

    if (mode === ResourceReportImportMode.VALIDATE_ONLY) {
      return validation;
    }

    if (!validation.valid) {
      throw new BadRequestException({
        message: 'Resource report import validation failed',
        report: validation,
      });
    }

    const upsert = await this.replaceAllocationsByActivity(
      projectId,
      parsed.rows,
    );

    return { ...validation, upsert };
  }

  private async validateRows(
    projectId: string,
    parsed: { sheetName: string; parsedRows: number; rows: ParsedResourceRow[] },
    mode: ResourceReportImportMode,
  ): Promise<ResourceImportValidation> {
    const issues: ResourceImportIssue[] = [];
    const activityCodes = [...new Set(parsed.rows.map((row) => row.activityCode))];
    const matchedTasks = await this.findTasksByActivityCodes(
      projectId,
      activityCodes,
    );
    const missingActivityCodes = activityCodes.filter(
      (code) => !matchedTasks.has(code),
    );

    for (const row of parsed.rows) {
      if (!matchedTasks.has(row.activityCode)) {
        issues.push({
          row: row.rowNumber,
          severity: 'error',
          field: 'activityCode',
          message: `No project task was found with WBS/activity code "${row.activityCode}"`,
          value: row.activityCode,
        });
      }

      if (row.costAmount === null && row.effectiveRate !== null) {
        issues.push({
          row: row.rowNumber,
          severity: 'warning',
          field: 'costAmount',
          message:
            'Cost is blank; import will keep it blank instead of calculating it.',
        });
      }
    }

    const errorCount = issues.filter(
      (issue) => issue.severity === 'error',
    ).length;
    const warningCount = issues.filter(
      (issue) => issue.severity === 'warning',
    ).length;

    return {
      mode,
      valid: errorCount === 0,
      summary: {
        sheetName: parsed.sheetName,
        parsedRows: parsed.parsedRows,
        importRows: parsed.rows.length,
        matchedTaskCount: matchedTasks.size,
        missingTaskCount: missingActivityCodes.length,
        phaseCount: new Set(parsed.rows.map((row) => row.phaseCode).filter(Boolean))
          .size,
        stageCount: new Set(parsed.rows.map((row) => row.stageCode).filter(Boolean))
          .size,
        activityCount: activityCodes.length,
        resourceTypeCount: new Set(parsed.rows.map((row) => row.resourceType))
          .size,
        totalCostAmount: parsed.rows.reduce(
          (sum, row) => sum + (row.costAmount ?? 0),
          0,
        ),
        errorCount,
        warningCount,
      },
      issues,
      preview: parsed.rows.slice(0, 20).map((row) => ({
        rowNumber: row.rowNumber,
        phaseCode: row.phaseCode,
        stageCode: row.stageCode,
        activityCode: row.activityCode,
        resourceType: row.resourceType,
        resourceName: row.resourceName,
        quantity: row.quantity,
        durationDays: row.durationDays,
        costAmount: row.costAmount,
        status: row.status,
      })),
    };
  }

  private async replaceAllocationsByActivity(
    projectId: string,
    rows: ParsedResourceRow[],
  ) {
    const activityCodes = [...new Set(rows.map((row) => row.activityCode))];
    const tasksByCode = await this.findTasksByActivityCodes(
      projectId,
      activityCodes,
    );
    const taskIds = [...tasksByCode.values()].map((task) => task.id);

    const deleteResult =
      taskIds.length > 0
        ? await this.allocationRepo.delete({ taskId: In(taskIds) })
        : { affected: 0 };

    const allocations = rows.map((row) => {
      const task = tasksByCode.get(row.activityCode);
      return this.allocationRepo.create({
        task,
        taskId: task?.id,
        phaseCode: row.phaseCode,
        phaseName: row.phaseName,
        stageCode: row.stageCode,
        stageName: row.stageName,
        activityCode: row.activityCode,
        activityName: row.activityName,
        resourceType: row.resourceType,
        resourceName: row.resourceName,
        quantity: row.quantity,
        durationDays: row.durationDays,
        defaultRate: row.defaultRate,
        overrideRate: row.overrideRate,
        effectiveRate: row.effectiveRate,
        costAmount: row.costAmount,
        currency: 'RWF',
        status: row.status,
      });
    });

    await this.allocationRepo.save(allocations);

    return {
      deletedAllocations: deleteResult.affected ?? 0,
      insertedAllocations: allocations.length,
      matchedActivityCodes: tasksByCode.size,
    };
  }

  private async findTasksByActivityCodes(
    projectId: string,
    activityCodes: string[],
  ): Promise<Map<string, Task>> {
    if (activityCodes.length === 0) return new Map();

    const tasks = await this.taskRepo.find({
      where: {
        projectId,
        wbsCode: In(activityCodes),
        deletedAt: IsNull(),
      },
    });

    return new Map(tasks.map((task) => [task.wbsCode ?? '', task]));
  }

  private async parseWorkbook(
    buffer: Buffer,
  ): Promise<{ sheetName: string; parsedRows: number; rows: ParsedResourceRow[] }> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      throw new BadRequestException('Resource report workbook has no sheets');
    }

    const header = this.findHeaderRow(worksheet);
    const rows: ParsedResourceRow[] = [];
    let parsedRows = 0;

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= header.rowNumber) return;
      parsedRows += 1;

      const activityCode = this.cellText(row.getCell(header.map.activityid));
      const resourceType = this.cellText(row.getCell(header.map.resourcetype));
      const resourceName = this.cellText(row.getCell(header.map.resourcename));

      if (!activityCode && !resourceType && !resourceName) return;
      if (!activityCode || !resourceType || !resourceName) return;

      rows.push({
        rowNumber,
        phaseCode: this.nullableCellText(row.getCell(header.map.phaseid)),
        phaseName: this.nullableCellText(row.getCell(header.map.phasename)),
        stageCode: this.nullableCellText(row.getCell(header.map.stageid)),
        stageName: this.nullableCellText(row.getCell(header.map.stagename)),
        activityCode,
        activityName: this.nullableCellText(row.getCell(header.map.activityname)),
        resourceType,
        resourceName,
        quantity: this.numberCell(row.getCell(header.map.qty)) ?? 0,
        durationDays: this.numberCell(row.getCell(header.map.durationdays)),
        defaultRate: this.numberCell(row.getCell(header.map.defaultrate)),
        overrideRate: header.map.overriderate
          ? this.numberCell(row.getCell(header.map.overriderate))
          : null,
        effectiveRate: this.numberCell(row.getCell(header.map.effectiverate)),
        costAmount: this.numberCell(row.getCell(header.map.costrwf)),
        status: this.nullableCellText(row.getCell(header.map.status)),
      });
    });

    return { sheetName: worksheet.name, parsedRows, rows };
  }

  private findHeaderRow(worksheet: ExcelJS.Worksheet): {
    rowNumber: number;
    map: Record<string, number>;
  } {
    for (let rowNumber = 1; rowNumber <= Math.min(10, worksheet.rowCount); rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const map: Record<string, number> = {};
      row.eachCell((cell, colNumber) => {
        const key = this.normalizeHeader(this.cellText(cell));
        if (key) map[key] = colNumber;
      });

      const hasRequired = TaskResourceReportImportService.REQUIRED_HEADERS.every(
        (header) => map[header] !== undefined,
      );
      if (hasRequired) {
        return { rowNumber, map };
      }
    }

    throw new BadRequestException(
      'Resource report header row was not found. Expected columns like Phase ID, Activity ID, Resource Type, Qty, Effective Rate, Cost (RWF), and Status.',
    );
  }

  private normalizeHeader(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private nullableCellText(cell: ExcelJS.Cell): string | null {
    const value = this.cellText(cell);
    return value || null;
  }

  private cellText(cell: ExcelJS.Cell): string {
    const value = cell.value;
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      if ('result' in value && value.result !== undefined) {
        return String(value.result).trim();
      }
      if ('text' in value && value.text !== undefined) {
        return String(value.text).trim();
      }
      if ('richText' in value && Array.isArray(value.richText)) {
        return value.richText.map((part) => part.text).join('').trim();
      }
    }
    return String(value).trim();
  }

  private numberCell(cell: ExcelJS.Cell): number | null {
    const text = this.cellText(cell).replace(/,/g, '');
    if (!text) return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  }
}
