import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { In, IsNull, Repository } from 'typeorm';
import {
  MaterialsReportImportDto,
  MaterialsReportImportMode,
} from '../dtos';
import { Task, TaskMaterial } from '../entities';
import type { ActivityScheduleUploadFile } from './activity-schedule-import.service';

type ImportIssueSeverity = 'error' | 'warning';

type MaterialImportIssue = {
  row: number | null;
  severity: ImportIssueSeverity;
  field: string;
  message: string;
  value?: string | number | null;
};

type ParsedMaterialRow = {
  rowNumber: number;
  phaseCode: string | null;
  stageCode: string | null;
  activityCode: string | null;
  activityName: string | null;
  taskCode: string;
  taskName: string | null;
  materialCategory: string;
  materialName: string;
  unit: string | null;
  quantity: number;
  defaultRate: number | null;
  wastePercent: number | null;
  materialCost: number | null;
  lookupStatus: string | null;
};

type MaterialsImportValidation = {
  mode: MaterialsReportImportMode;
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
    taskCount: number;
    materialCategoryCount: number;
    totalMaterialCost: number;
    errorCount: number;
    warningCount: number;
  };
  issues: MaterialImportIssue[];
  preview: Array<
    Pick<
      ParsedMaterialRow,
      | 'rowNumber'
      | 'phaseCode'
      | 'stageCode'
      | 'activityCode'
      | 'taskCode'
      | 'materialCategory'
      | 'materialName'
      | 'quantity'
      | 'defaultRate'
      | 'wastePercent'
      | 'materialCost'
      | 'lookupStatus'
    >
  >;
};

type MaterialsImportResult = MaterialsImportValidation & {
  upsert?: {
    deletedMaterials: number;
    insertedMaterials: number;
    matchedTaskCodes: number;
  };
};

type HeaderMap = Record<
  | 'phaseid'
  | 'stageid'
  | 'activityid'
  | 'activityname'
  | 'taskid'
  | 'taskname'
  | 'materialcategory'
  | 'materialname'
  | 'unit'
  | 'qty'
  | 'defaultrate'
  | 'waste'
  | 'materialcost'
  | 'lookupstatus',
  number
>;

@Injectable()
export class TaskMaterialsReportImportService {
  private static readonly HEADER_ALIASES: Record<keyof HeaderMap, string[]> = {
    phaseid: ['phaseid'],
    stageid: ['stageid'],
    activityid: ['activityid'],
    activityname: ['activityname'],
    taskid: ['taskid'],
    taskname: ['taskname'],
    materialcategory: ['materialcategory'],
    materialname: ['materialname'],
    unit: ['unit'],
    qty: ['qty', 'quantity'],
    defaultrate: ['defaultrate'],
    waste: ['waste', 'wastepercent'],
    materialcost: ['materialcostrwf', 'materialcost', 'costrwf', 'cost'],
    lookupstatus: ['lookupstatus', 'status'],
  };

  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(TaskMaterial)
    private readonly materialRepo: Repository<TaskMaterial>,
  ) {}

  async importProjectMaterialsReport(
    projectId: string,
    file: ActivityScheduleUploadFile | undefined,
    dto: MaterialsReportImportDto,
  ): Promise<MaterialsImportResult> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Materials report Excel file is required');
    }

    const mode = dto.mode ?? MaterialsReportImportMode.VALIDATE_ONLY;
    const parsed = await this.parseWorkbook(file.buffer);
    const validation = await this.validateRows(projectId, parsed, mode);

    if (mode === MaterialsReportImportMode.VALIDATE_ONLY) {
      return validation;
    }

    if (!validation.valid) {
      throw new BadRequestException({
        message: 'Materials report import validation failed',
        report: validation,
      });
    }

    const upsert =
      mode === MaterialsReportImportMode.REPLACE_BY_TASK
        ? await this.replaceMaterialsByTask(projectId, parsed.rows)
        : await this.appendMaterials(projectId, parsed.rows);

    return { ...validation, upsert };
  }

  private async validateRows(
    projectId: string,
    parsed: { sheetName: string; parsedRows: number; rows: ParsedMaterialRow[] },
    mode: MaterialsReportImportMode,
  ): Promise<MaterialsImportValidation> {
    const issues: MaterialImportIssue[] = [];
    const taskCodes = [...new Set(parsed.rows.map((row) => row.taskCode))];
    const matchedTasks = await this.findTasksByTaskCodes(projectId, taskCodes);
    const missingTaskCodes = taskCodes.filter((code) => !matchedTasks.has(code));

    for (const row of parsed.rows) {
      if (!matchedTasks.has(row.taskCode)) {
        issues.push({
          row: row.rowNumber,
          severity: 'error',
          field: 'taskCode',
          message: `No project task was found with WBS/task code "${row.taskCode}"`,
          value: row.taskCode,
        });
      }

      if (row.materialCost === null && row.defaultRate !== null) {
        issues.push({
          row: row.rowNumber,
          severity: 'warning',
          field: 'materialCost',
          message:
            'Material cost is blank; import will keep it blank instead of calculating it.',
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
        missingTaskCount: missingTaskCodes.length,
        phaseCount: new Set(parsed.rows.map((row) => row.phaseCode).filter(Boolean))
          .size,
        stageCount: new Set(parsed.rows.map((row) => row.stageCode).filter(Boolean))
          .size,
        activityCount: new Set(
          parsed.rows.map((row) => row.activityCode).filter(Boolean),
        ).size,
        taskCount: taskCodes.length,
        materialCategoryCount: new Set(
          parsed.rows.map((row) => row.materialCategory),
        ).size,
        totalMaterialCost: parsed.rows.reduce(
          (sum, row) => sum + (row.materialCost ?? 0),
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
        taskCode: row.taskCode,
        materialCategory: row.materialCategory,
        materialName: row.materialName,
        quantity: row.quantity,
        defaultRate: row.defaultRate,
        wastePercent: row.wastePercent,
        materialCost: row.materialCost,
        lookupStatus: row.lookupStatus,
      })),
    };
  }

  private async appendMaterials(projectId: string, rows: ParsedMaterialRow[]) {
    const tasksByCode = await this.findTasksByTaskCodes(
      projectId,
      [...new Set(rows.map((row) => row.taskCode))],
    );
    const materials = this.createMaterials(rows, tasksByCode);

    await this.materialRepo.save(materials);

    return {
      deletedMaterials: 0,
      insertedMaterials: materials.length,
      matchedTaskCodes: tasksByCode.size,
    };
  }

  private async replaceMaterialsByTask(projectId: string, rows: ParsedMaterialRow[]) {
    const taskCodes = [...new Set(rows.map((row) => row.taskCode))];
    const tasksByCode = await this.findTasksByTaskCodes(projectId, taskCodes);
    const taskIds = [...tasksByCode.values()].map((task) => task.id);

    const deleteResult =
      taskIds.length > 0
        ? await this.materialRepo.delete({ taskId: In(taskIds) })
        : { affected: 0 };

    const materials = this.createMaterials(rows, tasksByCode);
    await this.materialRepo.save(materials);

    return {
      deletedMaterials: deleteResult.affected ?? 0,
      insertedMaterials: materials.length,
      matchedTaskCodes: tasksByCode.size,
    };
  }

  private createMaterials(
    rows: ParsedMaterialRow[],
    tasksByCode: Map<string, Task>,
  ): TaskMaterial[] {
    return rows.map((row) => {
      const task = tasksByCode.get(row.taskCode);

      return this.materialRepo.create({
        task,
        taskId: task?.id,
        phaseCode: row.phaseCode,
        stageCode: row.stageCode,
        activityCode: row.activityCode,
        activityName: row.activityName,
        taskCode: row.taskCode,
        taskName: row.taskName,
        materialCategory: row.materialCategory,
        materialName: row.materialName,
        unit: row.unit,
        quantity: row.quantity,
        defaultRate: row.defaultRate,
        wastePercent: row.wastePercent,
        materialCost: row.materialCost,
        currency: 'RWF',
        lookupStatus: row.lookupStatus,
      });
    });
  }

  private async findTasksByTaskCodes(
    projectId: string,
    taskCodes: string[],
  ): Promise<Map<string, Task>> {
    if (taskCodes.length === 0) return new Map();

    const tasks = await this.taskRepo.find({
      where: {
        projectId,
        wbsCode: In(taskCodes),
        deletedAt: IsNull(),
      },
    });

    return new Map(tasks.map((task) => [task.wbsCode ?? '', task]));
  }

  private async parseWorkbook(
    buffer: Buffer,
  ): Promise<{ sheetName: string; parsedRows: number; rows: ParsedMaterialRow[] }> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      throw new BadRequestException('Materials report workbook has no sheets');
    }

    const header = this.findHeaderRow(worksheet);
    const rows: ParsedMaterialRow[] = [];
    let parsedRows = 0;
    const carry: Pick<
      ParsedMaterialRow,
      | 'phaseCode'
      | 'stageCode'
      | 'activityCode'
      | 'activityName'
      | 'taskCode'
      | 'taskName'
    > = {
      phaseCode: null,
      stageCode: null,
      activityCode: null,
      activityName: null,
      taskCode: '',
      taskName: null,
    };

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= header.rowNumber) return;
      parsedRows += 1;

      const materialCategory = this.cellText(
        row.getCell(header.map.materialcategory),
      );
      const materialName = this.cellText(row.getCell(header.map.materialname));
      const separator = this.cellText(row.getCell(header.map.materialcost));

      if (!materialCategory && !materialName && (!separator || separator === '-')) {
        return;
      }

      const phaseCode =
        this.nullableCellText(row.getCell(header.map.phaseid)) ?? carry.phaseCode;
      const stageCode =
        this.nullableCellText(row.getCell(header.map.stageid)) ?? carry.stageCode;
      const activityCode =
        this.nullableCellText(row.getCell(header.map.activityid)) ??
        carry.activityCode;
      const activityName =
        this.nullableCellText(row.getCell(header.map.activityname)) ??
        carry.activityName;
      const taskCode =
        this.nullableCellText(row.getCell(header.map.taskid)) ?? carry.taskCode;
      const taskName =
        this.nullableCellText(row.getCell(header.map.taskname)) ?? carry.taskName;

      if (phaseCode) carry.phaseCode = phaseCode;
      if (stageCode) carry.stageCode = stageCode;
      if (activityCode) carry.activityCode = activityCode;
      if (activityName) carry.activityName = activityName;
      if (taskCode) carry.taskCode = taskCode;
      if (taskName) carry.taskName = taskName;

      if (!taskCode || !materialCategory || !materialName) return;

      rows.push({
        rowNumber,
        phaseCode,
        stageCode,
        activityCode,
        activityName,
        taskCode,
        taskName,
        materialCategory,
        materialName,
        unit: this.nullableCellText(row.getCell(header.map.unit)),
        quantity: this.numberCell(row.getCell(header.map.qty)) ?? 0,
        defaultRate: this.numberCell(row.getCell(header.map.defaultrate)),
        wastePercent: this.percentCell(row.getCell(header.map.waste)),
        materialCost: this.numberCell(row.getCell(header.map.materialcost)),
        lookupStatus: this.nullableCellText(row.getCell(header.map.lookupstatus)),
      });
    });

    return { sheetName: worksheet.name, parsedRows, rows };
  }

  private findHeaderRow(worksheet: ExcelJS.Worksheet): {
    rowNumber: number;
    map: HeaderMap;
  } {
    for (
      let rowNumber = 1;
      rowNumber <= Math.min(10, worksheet.rowCount);
      rowNumber += 1
    ) {
      const row = worksheet.getRow(rowNumber);
      const found: Record<string, number> = {};
      row.eachCell((cell, colNumber) => {
        const key = this.normalizeHeader(this.cellText(cell));
        if (key) found[key] = colNumber;
      });

      const map = this.resolveHeaderMap(found);
      if (map) return { rowNumber, map };
    }

    throw new BadRequestException(
      'Materials report header row was not found. Expected columns like Phase ID, Task ID, Material Category, Material Name, Qty, Default Rate, Waste %, Material Cost (RWF), and Lookup Status.',
    );
  }

  private resolveHeaderMap(found: Record<string, number>): HeaderMap | null {
    const entries = Object.entries(
      TaskMaterialsReportImportService.HEADER_ALIASES,
    ) as Array<[keyof HeaderMap, string[]]>;
    const map = {} as HeaderMap;

    for (const [canonical, aliases] of entries) {
      const match = aliases.find((alias) => found[alias] !== undefined);
      if (!match) return null;
      map[canonical] = found[match];
    }

    return map;
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
    if (!text || text === '-' || text === '—') return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  }

  private percentCell(cell: ExcelJS.Cell): number | null {
    const text = this.cellText(cell).replace(/,/g, '').replace('%', '');
    if (!text || text === '-' || text === '—') return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  }
}
