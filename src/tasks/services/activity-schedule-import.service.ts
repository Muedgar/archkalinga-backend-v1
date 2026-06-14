import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { inflateRawSync } from 'node:zlib';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import { User } from 'src/users/entities';
import { ActivityScheduleImportDto, ActivityScheduleImportMode } from '../dtos';
import {
  DependencyType,
  ScheduleType,
  Task,
  TaskActivitySchedule,
  TaskDependency,
} from '../entities';
import { ProjectStatus, ProjectTaskType } from '../project-config';
import { ScheduleCalculationService } from './schedule-calculation.service';

type ParsedXlsxRow = {
  rowNumber: number;
  cells: Record<string, string>;
};

type ImportIssueSeverity = 'error' | 'warning';

type ImportIssue = {
  row: number | null;
  severity: ImportIssueSeverity;
  field: string;
  message: string;
  value?: string | number | null;
};

type ImportActivityRow = {
  rowNumber: number;
  phaseCode: string;
  phaseName: string | null;
  stageCode: string;
  stageName: string | null;
  activityCode: string;
  activityName: string | null;
  predecessorCode: string | null;
  dependencyType: DependencyType;
  lagDays: number;
  durationDays: number;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
};

type ImportValidationReport = {
  mode: ActivityScheduleImportMode;
  valid: boolean;
  summary: {
    sheetName: string;
    parsedRows: number;
    activityRows: number;
    phaseCount: number;
    stageCount: number;
    dependencyCount: number;
    duplicateActivityRowCount: number;
    negativeLagCount: number;
    milestoneCount: number;
    errorCount: number;
    warningCount: number;
  };
  issues: ImportIssue[];
  preview: Array<
    Pick<
      ImportActivityRow,
      | 'rowNumber'
      | 'phaseCode'
      | 'stageCode'
      | 'activityCode'
      | 'activityName'
      | 'predecessorCode'
      | 'dependencyType'
      | 'lagDays'
      | 'durationDays'
    >
  >;
};

type ImportResult = ImportValidationReport & {
  upsert?: {
    createdTasks: number;
    updatedTasks: number;
    schedulesUpserted: number;
    dependenciesUpserted: number;
    calculationRunId: string;
  };
};

export type ActivityScheduleUploadFile = {
  buffer: Buffer;
  originalname?: string;
  mimetype?: string;
};

type ZipEntry = {
  name: string;
  data: Buffer;
};

@Injectable()
export class ActivityScheduleImportService {
  private static readonly SHEET_NAME = 'xl/worksheets/sheet1.xml';
  private static readonly IMPORT_COLUMNS = {
    phaseCode: 'A',
    phaseName: 'B',
    stageCode: 'C',
    stageName: 'D',
    activityCode: 'E',
    activityName: 'F',
    predecessorCode: 'G',
    dependencyType: 'H',
    lagDays: 'I',
    durationDays: 'J',
  } as const;

  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(TaskActivitySchedule)
    private readonly scheduleRepo: Repository<TaskActivitySchedule>,
    @InjectRepository(TaskDependency)
    private readonly dependencyRepo: Repository<TaskDependency>,
    @InjectRepository(ProjectStatus)
    private readonly statusRepo: Repository<ProjectStatus>,
    @InjectRepository(ProjectTaskType)
    private readonly taskTypeRepo: Repository<ProjectTaskType>,
    private readonly calculationSvc: ScheduleCalculationService,
  ) {}

  async importProjectSchedule(
    projectId: string,
    file: ActivityScheduleUploadFile | undefined,
    dto: ActivityScheduleImportDto,
    actorUser: User,
  ): Promise<ImportResult> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Activity schedule Excel file is required');
    }

    const mode = dto.mode ?? ActivityScheduleImportMode.VALIDATE_ONLY;
    const validation = this.validateWorkbook(file.buffer, mode);
    if (mode === ActivityScheduleImportMode.VALIDATE_ONLY) {
      return validation;
    }

    if (!validation.valid) {
      throw new BadRequestException({
        message: 'Activity schedule import validation failed',
        report: validation,
      });
    }

    const rows = this.parseWorkbook(file.buffer);
    const activityRows = this.toActivityRows(rows.rows).activities;
    const upsert = await this.upsertByWbs(projectId, activityRows, actorUser);
    const calculation = await this.calculationSvc.recalculateProject(
      projectId,
      {
        triggerType: 'excel_import',
      },
    );

    return {
      ...validation,
      upsert: {
        ...upsert,
        calculationRunId: calculation.calculationRunId,
      },
    };
  }

  private validateWorkbook(
    workbook: Buffer,
    mode: ActivityScheduleImportMode,
  ): ImportValidationReport {
    const parsed = this.parseWorkbook(workbook);
    const { activities, issues } = this.toActivityRows(parsed.rows);
    const codes = new Set(activities.map((row) => row.activityCode));
    const firstByCode = new Map<string, ImportActivityRow>();
    const phases = new Set<string>();
    const stages = new Set<string>();
    let duplicateActivityRowCount = 0;

    for (const row of activities) {
      phases.add(row.phaseCode);
      stages.add(row.stageCode);

      const first = firstByCode.get(row.activityCode);
      if (first) {
        duplicateActivityRowCount += 1;
        const conflicts =
          first.phaseCode !== row.phaseCode ||
          first.stageCode !== row.stageCode ||
          first.durationDays !== row.durationDays;
        issues.push({
          row: row.rowNumber,
          severity: conflicts ? 'error' : 'warning',
          field: 'activityCode',
          message: conflicts
            ? `Duplicate activity WBS code "${row.activityCode}" has conflicting phase, stage, or duration`
            : `Duplicate activity WBS code "${row.activityCode}" will be merged into one task with multiple dependency rows`,
          value: row.activityCode,
        });
      } else {
        firstByCode.set(row.activityCode, row);
      }

      if (row.predecessorCode && !codes.has(row.predecessorCode)) {
        issues.push({
          row: row.rowNumber,
          severity: 'error',
          field: 'predecessorCode',
          message: `Predecessor WBS code "${row.predecessorCode}" was not found in the import file`,
          value: row.predecessorCode,
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
        parsedRows: parsed.rows.length,
        activityRows: activities.length,
        phaseCount: phases.size,
        stageCount: stages.size,
        dependencyCount: activities.filter((row) => row.predecessorCode).length,
        duplicateActivityRowCount,
        negativeLagCount: activities.filter((row) => row.lagDays < 0).length,
        milestoneCount: activities.filter((row) => row.durationDays === 0)
          .length,
        errorCount,
        warningCount,
      },
      issues,
      preview: activities.slice(0, 20).map((row) => ({
        rowNumber: row.rowNumber,
        phaseCode: row.phaseCode,
        stageCode: row.stageCode,
        activityCode: row.activityCode,
        activityName: row.activityName,
        predecessorCode: row.predecessorCode,
        dependencyType: row.dependencyType,
        lagDays: row.lagDays,
        durationDays: row.durationDays,
      })),
    };
  }

  private async upsertByWbs(
    projectId: string,
    rows: ImportActivityRow[],
    actorUser: User,
  ): Promise<{
    createdTasks: number;
    updatedTasks: number;
    schedulesUpserted: number;
    dependenciesUpserted: number;
  }> {
    const defaultStatus = await this.statusRepo.findOne({
      where: { projectId, isDefault: true, isActive: true },
      order: { orderIndex: 'ASC', createdAt: 'ASC' },
    });
    const defaultTaskType = await this.taskTypeRepo.findOne({
      where: { projectId, isDefault: true, isActive: true },
      order: { createdAt: 'ASC' },
    });

    if (!defaultStatus || !defaultTaskType) {
      throw new BadRequestException(
        'Project must have a default active status and task type before importing an activity schedule',
      );
    }

    const uniqueActivityRows = this.uniqueActivityRows(rows);
    const phases = this.uniqueSummaryRows(rows, 'phase');
    const stages = this.uniqueSummaryRows(rows, 'stage');
    const allCodes = [
      ...phases.map((row) => row.code),
      ...stages.map((row) => row.code),
      ...uniqueActivityRows.map((row) => row.activityCode),
    ];

    const existing = await this.taskRepo.find({
      where: { projectId, wbsCode: In(allCodes), deletedAt: IsNull() },
    });
    const taskByWbs = new Map(
      existing
        .filter((task) => task.wbsCode)
        .map((task) => [task.wbsCode as string, task]),
    );

    let createdTasks = 0;
    let updatedTasks = 0;
    let dependenciesUpserted = 0;

    await this.taskRepo.manager.transaction(async (tx) => {
      for (const phase of phases) {
        const result = await this.upsertTask(tx, taskByWbs, {
          projectId,
          code: phase.code,
          title: phase.name || `Phase ${phase.code}`,
          scheduleType: ScheduleType.PHASE,
          parentTaskId: null,
          defaultStatusId: defaultStatus.id,
          defaultTaskTypeId: defaultTaskType.id,
          actorUserId: actorUser.id,
        });
        createdTasks += result.created ? 1 : 0;
        updatedTasks += result.created ? 0 : 1;
      }

      for (const stage of stages) {
        const result = await this.upsertTask(tx, taskByWbs, {
          projectId,
          code: stage.code,
          title: stage.name || `Stage ${stage.code}`,
          scheduleType: ScheduleType.STAGE,
          parentTaskId: stage.parentCode
            ? (taskByWbs.get(stage.parentCode)?.id ?? null)
            : null,
          defaultStatusId: defaultStatus.id,
          defaultTaskTypeId: defaultTaskType.id,
          actorUserId: actorUser.id,
        });
        createdTasks += result.created ? 1 : 0;
        updatedTasks += result.created ? 0 : 1;
      }

      for (const row of uniqueActivityRows) {
        const result = await this.upsertTask(tx, taskByWbs, {
          projectId,
          code: row.activityCode,
          title: row.activityName || `Activity ${row.activityCode}`,
          scheduleType:
            row.durationDays === 0
              ? ScheduleType.MILESTONE
              : ScheduleType.ACTIVITY,
          parentTaskId: taskByWbs.get(row.stageCode)?.id ?? null,
          defaultStatusId: defaultStatus.id,
          defaultTaskTypeId: defaultTaskType.id,
          actorUserId: actorUser.id,
        });
        createdTasks += result.created ? 1 : 0;
        updatedTasks += result.created ? 0 : 1;
      }

      const taskIds = uniqueActivityRows
        .map((row) => taskByWbs.get(row.activityCode)?.id)
        .filter((id): id is string => Boolean(id));
      const existingSchedules = await tx.find(TaskActivitySchedule, {
        where: { taskId: In(taskIds) },
      });
      const scheduleByTaskId = new Map(
        existingSchedules.map((schedule) => [schedule.taskId, schedule]),
      );
      const schedules = uniqueActivityRows.map((row) => {
        const taskId = taskByWbs.get(row.activityCode)?.id as string;
        const schedule =
          scheduleByTaskId.get(taskId) ??
          tx.create(TaskActivitySchedule, { taskId });
        schedule.durationDays = row.durationDays;
        schedule.plannedStartDate = row.plannedStartDate;
        schedule.plannedEndDate = row.plannedEndDate;
        schedule.actualStartDate = row.actualStartDate;
        schedule.actualEndDate = row.actualEndDate;
        schedule.isManuallyScheduled = false;
        schedule.manualReason = null;
        return schedule;
      });
      await tx.save(TaskActivitySchedule, schedules);

      const dependencyPairByKey = new Map<
        string,
        {
          successorId: string;
          predecessorId: string;
          row: ImportActivityRow;
        }
      >();
      rows
        .filter((row) => row.predecessorCode)
        .forEach((row) => {
          const successorId = taskByWbs.get(row.activityCode)?.id as string;
          const predecessorId = taskByWbs.get(row.predecessorCode as string)
            ?.id as string;
          dependencyPairByKey.set(`${successorId}:${predecessorId}`, {
            successorId,
            predecessorId,
            row,
          });
        });
      const dependencyPairs = [...dependencyPairByKey.values()];
      dependenciesUpserted = dependencyPairs.length;
      const existingDeps = dependencyPairs.length
        ? await tx.find(TaskDependency, {
            where: dependencyPairs.map((pair) => ({
              taskId: pair.successorId,
              dependsOnTaskId: pair.predecessorId,
            })),
          })
        : [];
      const dependencyByPair = new Map(
        existingDeps.map((dep) => [
          `${dep.taskId}:${dep.dependsOnTaskId}`,
          dep,
        ]),
      );
      const dependencies = dependencyPairs.map((pair) => {
        const key = `${pair.successorId}:${pair.predecessorId}`;
        const dependency =
          dependencyByPair.get(key) ??
          tx.create(TaskDependency, {
            taskId: pair.successorId,
            dependsOnTaskId: pair.predecessorId,
          });
        dependency.dependencyType = pair.row.dependencyType;
        dependency.lagDays = pair.row.lagDays;
        return dependency;
      });
      if (dependencies.length) {
        await tx.save(TaskDependency, dependencies);
      }
    });

    return {
      createdTasks,
      updatedTasks,
      schedulesUpserted: uniqueActivityRows.length,
      dependenciesUpserted,
    };
  }

  private uniqueActivityRows(rows: ImportActivityRow[]): ImportActivityRow[] {
    const byCode = new Map<string, ImportActivityRow>();
    for (const row of rows) {
      if (!byCode.has(row.activityCode)) {
        byCode.set(row.activityCode, row);
      }
    }
    return [...byCode.values()].sort((a, b) =>
      this.toWbsSortKey(a.activityCode).localeCompare(
        this.toWbsSortKey(b.activityCode),
      ),
    );
  }

  private async upsertTask(
    tx: EntityManager,
    taskByWbs: Map<string, Task>,
    input: {
      projectId: string;
      code: string;
      title: string;
      scheduleType: ScheduleType;
      parentTaskId: string | null;
      defaultStatusId: string;
      defaultTaskTypeId: string;
      actorUserId: string;
    },
  ): Promise<{ task: Task; created: boolean }> {
    const existing = taskByWbs.get(input.code);
    if (existing) {
      existing.title = input.title;
      existing.scheduleType = input.scheduleType;
      existing.parentTaskId = input.parentTaskId;
      existing.wbsSortKey = this.toWbsSortKey(input.code);
      const saved = await tx.save(Task, existing);
      taskByWbs.set(input.code, saved);
      return { task: saved, created: false };
    }

    const task = tx.create(Task, {
      projectId: input.projectId,
      title: input.title,
      description: null,
      statusId: input.defaultStatusId,
      taskTypeId: input.defaultTaskTypeId,
      priorityId: null,
      severityId: null,
      startDate: null,
      endDate: null,
      progress: null,
      completed: false,
      scheduleType: input.scheduleType,
      wbsCode: input.code,
      wbsSortKey: this.toWbsSortKey(input.code),
      weightPercent: null,
      isManuallyScheduled: false,
      manualScheduleReason: null,
      rank: null,
      parentTaskId: input.parentTaskId,
      createdByUserId: input.actorUserId,
      reporteeUserId: null,
    });
    const saved = await tx.save(Task, task);
    taskByWbs.set(input.code, saved);
    return { task: saved, created: true };
  }

  private uniqueSummaryRows(
    rows: ImportActivityRow[],
    level: 'phase' | 'stage',
  ): Array<{
    code: string;
    name: string | null;
    parentCode: string | null;
  }> {
    const summaries = new Map<
      string,
      { code: string; name: string | null; parentCode: string | null }
    >();
    for (const row of rows) {
      if (level === 'phase') {
        summaries.set(row.phaseCode, {
          code: row.phaseCode,
          name: row.phaseName,
          parentCode: null,
        });
      } else {
        summaries.set(row.stageCode, {
          code: row.stageCode,
          name: row.stageName,
          parentCode: row.phaseCode,
        });
      }
    }
    return [...summaries.values()].sort((a, b) =>
      this.toWbsSortKey(a.code).localeCompare(this.toWbsSortKey(b.code)),
    );
  }

  private toActivityRows(rows: ParsedXlsxRow[]): {
    activities: ImportActivityRow[];
    issues: ImportIssue[];
  } {
    const issues: ImportIssue[] = [];
    const activities: ImportActivityRow[] = [];
    let currentPhaseCode: string | null = null;
    let currentPhaseName: string | null = null;
    let currentStageCode: string | null = null;
    let currentStageName: string | null = null;

    for (const row of rows) {
      const activityCode = this.normalizeCode(
        row.cells[ActivityScheduleImportService.IMPORT_COLUMNS.activityCode],
      );
      if (!activityCode || !/\d/.test(activityCode)) {
        continue;
      }

      const predecessorCode =
        this.normalizeCode(
          row.cells[
            ActivityScheduleImportService.IMPORT_COLUMNS.predecessorCode
          ],
        ) ?? null;
      const rawPhaseCode = this.normalizeCode(
        row.cells[ActivityScheduleImportService.IMPORT_COLUMNS.phaseCode],
      );
      const rawStageCode = this.normalizeCode(
        row.cells[ActivityScheduleImportService.IMPORT_COLUMNS.stageCode],
      );
      const rawPhaseName = this.clean(
        row.cells[ActivityScheduleImportService.IMPORT_COLUMNS.phaseName],
      );
      const rawStageName = this.clean(
        row.cells[ActivityScheduleImportService.IMPORT_COLUMNS.stageName],
      );
      currentPhaseCode = rawPhaseCode ?? currentPhaseCode;
      currentPhaseName = rawPhaseName ?? currentPhaseName;
      currentStageCode = rawStageCode ?? currentStageCode;
      currentStageName = rawStageName ?? currentStageName;
      const phaseCode = currentPhaseCode;
      const stageCode = currentStageCode;
      const dependencyType = this.normalizeDependencyType(
        row.cells[ActivityScheduleImportService.IMPORT_COLUMNS.dependencyType],
      );
      const lagDays = this.parseNumber(
        row.cells[ActivityScheduleImportService.IMPORT_COLUMNS.lagDays],
      );
      const durationDays = this.parseNumber(
        row.cells[ActivityScheduleImportService.IMPORT_COLUMNS.durationDays],
      );

      if (!phaseCode) {
        issues.push(
          this.error(row.rowNumber, 'phaseCode', 'Phase WBS code is required'),
        );
      }
      if (!stageCode) {
        issues.push(
          this.error(row.rowNumber, 'stageCode', 'Stage WBS code is required'),
        );
      }
      if (predecessorCode && !dependencyType) {
        issues.push(
          this.error(
            row.rowNumber,
            'dependencyType',
            'Dependency type must be FS, SS, FF, or SF',
            row.cells[
              ActivityScheduleImportService.IMPORT_COLUMNS.dependencyType
            ] ?? null,
          ),
        );
      }
      if (durationDays === null || durationDays < 0) {
        issues.push(
          this.error(
            row.rowNumber,
            'durationDays',
            'Duration must be a zero or positive number of days',
            row.cells[
              ActivityScheduleImportService.IMPORT_COLUMNS.durationDays
            ] ?? null,
          ),
        );
      }

      activities.push({
        rowNumber: row.rowNumber,
        phaseCode: phaseCode || 'unknown-phase',
        phaseName: currentPhaseName,
        stageCode: stageCode || 'unknown-stage',
        stageName: currentStageName,
        activityCode,
        activityName:
          this.clean(
            row.cells[
              ActivityScheduleImportService.IMPORT_COLUMNS.activityName
            ],
          ) ?? null,
        predecessorCode,
        dependencyType: dependencyType ?? DependencyType.FINISH_TO_START,
        lagDays: lagDays ?? 0,
        durationDays: durationDays ?? 0,
        plannedStartDate: null,
        plannedEndDate: null,
        actualStartDate: null,
        actualEndDate: null,
      });
    }

    if (!activities.length) {
      issues.push({
        row: null,
        severity: 'error',
        field: 'activityCode',
        message:
          'No activity rows found. Expected activity WBS codes in column E.',
      });
    }

    return { activities, issues };
  }

  private parseWorkbook(workbook: Buffer): {
    sheetName: string;
    rows: ParsedXlsxRow[];
  } {
    const entries = this.readZipEntries(workbook);
    const entryByName = new Map(entries.map((entry) => [entry.name, entry]));
    const sheet = entryByName.get(ActivityScheduleImportService.SHEET_NAME);
    if (!sheet) {
      throw new BadRequestException(
        'The uploaded workbook does not contain sheet1.xml',
      );
    }

    const sharedStrings = this.parseSharedStrings(
      entryByName.get('xl/sharedStrings.xml')?.data.toString('utf8') ?? '',
    );
    return {
      sheetName: ActivityScheduleImportService.SHEET_NAME,
      rows: this.parseSheet(sheet.data.toString('utf8'), sharedStrings),
    };
  }

  private readZipEntries(buffer: Buffer): ZipEntry[] {
    const eocdOffset = this.findEndOfCentralDirectory(buffer);
    if (eocdOffset < 0) {
      throw new BadRequestException(
        'The uploaded file is not a valid .xlsx workbook',
      );
    }

    const entryCount = buffer.readUInt16LE(eocdOffset + 10);
    const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
    const entries: ZipEntry[] = [];
    let offset = centralDirectoryOffset;

    for (let i = 0; i < entryCount; i += 1) {
      if (buffer.readUInt32LE(offset) !== 0x02014b50) {
        throw new BadRequestException(
          'The uploaded workbook has an invalid ZIP directory',
        );
      }
      const compressionMethod = buffer.readUInt16LE(offset + 10);
      const compressedSize = buffer.readUInt32LE(offset + 20);
      const fileNameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const localHeaderOffset = buffer.readUInt32LE(offset + 42);
      const name = buffer
        .subarray(offset + 46, offset + 46 + fileNameLength)
        .toString('utf8');

      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset =
        localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(
        dataOffset,
        dataOffset + compressedSize,
      );
      const data =
        compressionMethod === 0
          ? compressed
          : compressionMethod === 8
            ? inflateRawSync(compressed)
            : null;
      if (data) {
        entries.push({ name, data });
      }
      offset += 46 + fileNameLength + extraLength + commentLength;
    }

    return entries;
  }

  private findEndOfCentralDirectory(buffer: Buffer): number {
    const signature = 0x06054b50;
    const minOffset = Math.max(0, buffer.length - 65557);
    for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
      if (buffer.readUInt32LE(offset) === signature) {
        return offset;
      }
    }
    return -1;
  }

  private parseSharedStrings(xml: string): string[] {
    if (!xml) {
      return [];
    }
    const strings: string[] = [];
    const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let match: RegExpExecArray | null;
    while ((match = siRegex.exec(xml))) {
      const textParts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)];
      strings.push(
        textParts
          .map((part) => this.decodeXml(part[1]))
          .join('')
          .trim(),
      );
    }
    return strings;
  }

  private parseSheet(xml: string, sharedStrings: string[]): ParsedXlsxRow[] {
    const rows: ParsedXlsxRow[] = [];
    const rowRegex = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(xml))) {
      const rowNumber = Number(this.attr(rowMatch[1], 'r')) || rows.length + 1;
      const cells: Record<string, string> = {};
      const cellRegex = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(rowMatch[2]))) {
        if (cellMatch[1]) {
          continue;
        }
        const attrs = cellMatch[2];
        const body = cellMatch[3] ?? '';
        const ref = this.attr(attrs, 'r');
        const column = ref?.replace(/\d+/g, '');
        if (!column) {
          continue;
        }
        const value = this.cellValue(attrs, body, sharedStrings);
        if (value !== null) {
          cells[column] = value;
        }
      }
      rows.push({ rowNumber, cells });
    }
    return rows;
  }

  private cellValue(
    attrs: string,
    body: string,
    sharedStrings: string[],
  ): string | null {
    if (/<f\b/.test(body)) {
      return null;
    }

    const type = this.attr(attrs, 't');
    if (type === 'inlineStr') {
      const text = body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/)?.[1];
      return text === undefined ? null : this.decodeXml(text).trim();
    }

    const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
    if (raw === undefined) {
      return null;
    }

    if (type === 's') {
      return sharedStrings[Number(raw)] ?? '';
    }

    return this.decodeXml(raw).trim();
  }

  private attr(source: string, name: string): string | null {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`${escapedName}="([^"]*)"`, 'i'));
    return match?.[1] ?? null;
  }

  private decodeXml(value: string): string {
    return value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  private normalizeDependencyType(
    value: string | undefined,
  ): DependencyType | null {
    const normalized = this.clean(value)?.toUpperCase();
    if (
      normalized === DependencyType.FINISH_TO_START ||
      normalized === DependencyType.START_TO_START ||
      normalized === DependencyType.FINISH_TO_FINISH ||
      normalized === DependencyType.START_TO_FINISH
    ) {
      return normalized as DependencyType;
    }
    return null;
  }

  private normalizeCode(value: string | undefined): string | null {
    const cleaned = this.clean(value);
    if (!cleaned) {
      return null;
    }
    return cleaned.replace(/\.0+$/, '');
  }

  private parseNumber(value: string | undefined): number | null {
    const cleaned = this.clean(value);
    if (!cleaned) {
      return null;
    }
    const parsed = Number(cleaned.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private clean(value: string | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private toWbsSortKey(code: string): string {
    return code
      .split('.')
      .map((part) => {
        const numeric = Number(part);
        return Number.isInteger(numeric)
          ? numeric.toString().padStart(6, '0')
          : part.toUpperCase().padStart(6, '0');
      })
      .join('.');
  }

  private error(
    row: number,
    field: string,
    message: string,
    value?: string | number | null,
  ): ImportIssue {
    return { row, severity: 'error', field, message, value };
  }
}
