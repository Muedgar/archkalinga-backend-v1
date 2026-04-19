import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Repository } from 'typeorm';
import { OutboxService } from 'src/outbox/outbox.service';
import {
  ProjectLabel,
  ProjectPriority,
  ProjectSeverity,
  ProjectStatus,
  ProjectTaskType,
  StatusCategory,
} from 'src/tasks/project-config';
import { Project } from './entities';
import {
  CreateProjectLabelDto,
  CreateProjectPriorityDto,
  CreateProjectSeverityDto,
  CreateProjectStatusDto,
  CreateProjectTaskTypeDto,
  UpdateProjectLabelDto,
  UpdateProjectPriorityDto,
  UpdateProjectSeverityDto,
  UpdateProjectStatusDto,
  UpdateProjectTaskTypeDto,
} from './dtos/project-config.dto';
import {
  CONFIG_LABEL_KEY_TAKEN,
  CONFIG_LABEL_NOT_FOUND,
  CONFIG_PRIORITY_HAS_TASKS,
  CONFIG_PRIORITY_KEY_TAKEN,
  CONFIG_PRIORITY_NOT_FOUND,
  CONFIG_SEVERITY_KEY_TAKEN,
  CONFIG_SEVERITY_NOT_FOUND,
  CONFIG_STATUS_HAS_TASKS,
  CONFIG_STATUS_KEY_TAKEN,
  CONFIG_STATUS_NOT_FOUND,
  CONFIG_TASK_TYPE_HAS_TASKS,
  CONFIG_TASK_TYPE_KEY_TAKEN,
  CONFIG_TASK_TYPE_NOT_FOUND,
  PROJECT_NOT_FOUND,
} from './messages';
import {
  ProjectLabelSerializer,
  ProjectPrioritySerializer,
  ProjectSeveritySerializer,
  ProjectStatusSerializer,
  ProjectTaskTypeSerializer,
} from './serializers/project-config.serializer';

@Injectable()
export class ProjectConfigService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,

    @InjectRepository(ProjectStatus)
    private readonly statusRepo: Repository<ProjectStatus>,

    @InjectRepository(ProjectPriority)
    private readonly priorityRepo: Repository<ProjectPriority>,

    @InjectRepository(ProjectSeverity)
    private readonly severityRepo: Repository<ProjectSeverity>,

    @InjectRepository(ProjectTaskType)
    private readonly taskTypeRepo: Repository<ProjectTaskType>,

    @InjectRepository(ProjectLabel)
    private readonly labelRepo: Repository<ProjectLabel>,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Fire-and-forget outbox write for config mutations.
   * Config events are low-frequency; a best-effort write is acceptable.
   */
  private emitConfigEvent(
    resourceType: string,
    aggregateId: string,
    projectId: string,
    action: 'created' | 'updated' | 'deleted',
    extra?: Record<string, unknown>,
  ): void {
    void this.outboxService.recordNow({
      aggregateType: `project-config.${resourceType}`,
      aggregateId,
      eventType: `project.config.${resourceType}.${action}`,
      payload: { projectId, aggregateId, action, ...extra },
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async ensureProject(projectId: string): Promise<Project> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException(PROJECT_NOT_FOUND);
    return project;
  }

  private async ensureKeyAvailable<T extends { id: string; key: string; projectId: string }>(
    repo: Repository<T>,
    projectId: string,
    key: string,
    errorMsg: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await repo.findOne({
      where: { projectId, key } as unknown as Parameters<typeof repo.findOne>[0]['where'],
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(errorMsg);
    }
  }

  private toStatus(entity: ProjectStatus): ProjectStatusSerializer {
    return plainToInstance(ProjectStatusSerializer, entity, { excludeExtraneousValues: true });
  }
  private toPriority(entity: ProjectPriority): ProjectPrioritySerializer {
    return plainToInstance(ProjectPrioritySerializer, entity, { excludeExtraneousValues: true });
  }
  private toSeverity(entity: ProjectSeverity): ProjectSeveritySerializer {
    return plainToInstance(ProjectSeveritySerializer, entity, { excludeExtraneousValues: true });
  }
  private toTaskType(entity: ProjectTaskType): ProjectTaskTypeSerializer {
    return plainToInstance(ProjectTaskTypeSerializer, entity, { excludeExtraneousValues: true });
  }
  private toLabel(entity: ProjectLabel): ProjectLabelSerializer {
    return plainToInstance(ProjectLabelSerializer, entity, { excludeExtraneousValues: true });
  }

  /**
   * Seed all 5 config tables for a newly created project.
   * Called from ProjectsService.createProject().
   */
  async seedDefaults(project: Project): Promise<void> {
    const pid = project.id;
    const pkid = project.pkid;

    // ── Statuses ──────────────────────────────────────────────────────────────
    const statusSeeds: Partial<ProjectStatus>[] = [
      { name: 'To Do',       key: 'todo',        color: '#6B7280', orderIndex: 0, category: StatusCategory.TODO,        isDefault: true,  isTerminal: false },
      { name: 'In Progress', key: 'in_progress',  color: '#3B82F6', orderIndex: 1, category: StatusCategory.IN_PROGRESS, isDefault: false, isTerminal: false },
      { name: 'In Review',   key: 'in_review',    color: '#F59E0B', orderIndex: 2, category: StatusCategory.IN_PROGRESS, isDefault: false, isTerminal: false },
      { name: 'Done',        key: 'done',         color: '#10B981', orderIndex: 3, category: StatusCategory.DONE,        isDefault: false, isTerminal: true  },
      { name: 'Blocked',     key: 'blocked',      color: '#EF4444', orderIndex: 4, category: StatusCategory.IN_PROGRESS, isDefault: false, isTerminal: false },
    ];
    await this.statusRepo.save(
      statusSeeds.map((s) => this.statusRepo.create({ ...s, projectId: pid, project: { pkid } as Project })),
    );

    // ── Priorities ────────────────────────────────────────────────────────────
    const prioritySeeds: Partial<ProjectPriority>[] = [
      { name: 'Low',    key: 'low',    color: '#6B7280', orderIndex: 0, isDefault: false },
      { name: 'Medium', key: 'medium', color: '#F59E0B', orderIndex: 1, isDefault: true  },
      { name: 'High',   key: 'high',   color: '#EF4444', orderIndex: 2, isDefault: false },
      { name: 'Urgent', key: 'urgent', color: '#DC2626', orderIndex: 3, isDefault: false },
    ];
    await this.priorityRepo.save(
      prioritySeeds.map((p) => this.priorityRepo.create({ ...p, projectId: pid, project: { pkid } as Project })),
    );

    // ── Severities ────────────────────────────────────────────────────────────
    const severitySeeds: Partial<ProjectSeverity>[] = [
      { name: 'Minor',    key: 'minor',    color: '#6B7280', orderIndex: 0, isDefault: true  },
      { name: 'Major',    key: 'major',    color: '#F59E0B', orderIndex: 1, isDefault: false },
      { name: 'Critical', key: 'critical', color: '#DC2626', orderIndex: 2, isDefault: false },
    ];
    await this.severityRepo.save(
      severitySeeds.map((s) => this.severityRepo.create({ ...s, projectId: pid, project: { pkid } as Project })),
    );

    // ── Task Types ────────────────────────────────────────────────────────────
    const taskTypeSeeds: Partial<ProjectTaskType>[] = [
      { name: 'Task',    key: 'task',    color: '#3B82F6', icon: null, isDefault: true,  isSubtaskType: false },
      { name: 'Bug',     key: 'bug',     color: '#EF4444', icon: null, isDefault: false, isSubtaskType: false },
      { name: 'Feature', key: 'feature', color: '#10B981', icon: null, isDefault: false, isSubtaskType: false },
      { name: 'Story',   key: 'story',   color: '#8B5CF6', icon: null, isDefault: false, isSubtaskType: false },
      { name: 'Subtask', key: 'subtask', color: '#6B7280', icon: null, isDefault: false, isSubtaskType: true  },
    ];
    await this.taskTypeRepo.save(
      taskTypeSeeds.map((t) => this.taskTypeRepo.create({ ...t, projectId: pid, project: { pkid } as Project })),
    );

    // Labels: no defaults seeded
  }

  // ── Status CRUD ────────────────────────────────────────────────────────────

  async listStatuses(projectId: string): Promise<ProjectStatusSerializer[]> {
    await this.ensureProject(projectId);
    const rows = await this.statusRepo.find({
      where: { projectId },
      order: { orderIndex: 'ASC' },
    });
    return rows.map((r) => this.toStatus(r));
  }

  async getStatus(projectId: string, statusId: string): Promise<ProjectStatusSerializer> {
    await this.ensureProject(projectId);
    const row = await this.statusRepo.findOne({ where: { id: statusId, projectId } });
    if (!row) throw new NotFoundException(CONFIG_STATUS_NOT_FOUND);
    return this.toStatus(row);
  }

  async createStatus(
    projectId: string,
    dto: CreateProjectStatusDto,
  ): Promise<ProjectStatusSerializer> {
    const project = await this.ensureProject(projectId);
    await this.ensureKeyAvailable(this.statusRepo, projectId, dto.key, CONFIG_STATUS_KEY_TAKEN);

    if (dto.isDefault) {
      await this.statusRepo.update({ projectId, isDefault: true }, { isDefault: false });
    }

    const saved = await this.statusRepo.save(
      this.statusRepo.create({
        ...dto,
        projectId,
        project,
        color:      dto.color      ?? '#6B7280',
        orderIndex: dto.orderIndex ?? 0,
        category:   dto.category   ?? StatusCategory.IN_PROGRESS,
        isDefault:  dto.isDefault  ?? false,
        isTerminal: dto.isTerminal ?? false,
      }),
    );
    this.emitConfigEvent('status', saved.id, projectId, 'created', { key: saved.key });
    return this.toStatus(saved);
  }

  async updateStatus(
    projectId: string,
    statusId: string,
    dto: UpdateProjectStatusDto,
  ): Promise<ProjectStatusSerializer> {
    await this.ensureProject(projectId);
    const row = await this.statusRepo.findOne({ where: { id: statusId, projectId } });
    if (!row) throw new NotFoundException(CONFIG_STATUS_NOT_FOUND);

    if (dto.isDefault === true && !row.isDefault) {
      await this.statusRepo.update({ projectId, isDefault: true }, { isDefault: false });
    }

    Object.assign(row, dto);
    const saved = await this.statusRepo.save(row);
    this.emitConfigEvent('status', statusId, projectId, 'updated', { key: saved.key });
    return this.toStatus(saved);
  }

  async deleteStatus(projectId: string, statusId: string): Promise<{ id: string }> {
    await this.ensureProject(projectId);
    const row = await this.statusRepo.findOne({ where: { id: statusId, projectId } });
    if (!row) throw new NotFoundException(CONFIG_STATUS_NOT_FOUND);

    // Guard: cannot delete if tasks reference this status
    const taskCount = await this.statusRepo.manager
      .getRepository('tasks')
      .count({ where: { statusId } });
    if (taskCount > 0) throw new BadRequestException(CONFIG_STATUS_HAS_TASKS);

    await this.statusRepo.remove(row);
    this.emitConfigEvent('status', statusId, projectId, 'deleted');
    return { id: statusId };
  }

  // ── Priority CRUD ──────────────────────────────────────────────────────────

  async listPriorities(projectId: string): Promise<ProjectPrioritySerializer[]> {
    await this.ensureProject(projectId);
    const rows = await this.priorityRepo.find({
      where: { projectId },
      order: { orderIndex: 'ASC' },
    });
    return rows.map((r) => this.toPriority(r));
  }

  async getPriority(projectId: string, priorityId: string): Promise<ProjectPrioritySerializer> {
    await this.ensureProject(projectId);
    const row = await this.priorityRepo.findOne({ where: { id: priorityId, projectId } });
    if (!row) throw new NotFoundException(CONFIG_PRIORITY_NOT_FOUND);
    return this.toPriority(row);
  }

  async createPriority(
    projectId: string,
    dto: CreateProjectPriorityDto,
  ): Promise<ProjectPrioritySerializer> {
    const project = await this.ensureProject(projectId);
    await this.ensureKeyAvailable(this.priorityRepo, projectId, dto.key, CONFIG_PRIORITY_KEY_TAKEN);

    if (dto.isDefault) {
      await this.priorityRepo.update({ projectId, isDefault: true }, { isDefault: false });
    }

    const saved = await this.priorityRepo.save(
      this.priorityRepo.create({
        ...dto,
        projectId,
        project,
        color:      dto.color      ?? '#6B7280',
        orderIndex: dto.orderIndex ?? 0,
        isDefault:  dto.isDefault  ?? false,
      }),
    );
    this.emitConfigEvent('priority', saved.id, projectId, 'created', { key: saved.key });
    return this.toPriority(saved);
  }

  async updatePriority(
    projectId: string,
    priorityId: string,
    dto: UpdateProjectPriorityDto,
  ): Promise<ProjectPrioritySerializer> {
    await this.ensureProject(projectId);
    const row = await this.priorityRepo.findOne({ where: { id: priorityId, projectId } });
    if (!row) throw new NotFoundException(CONFIG_PRIORITY_NOT_FOUND);

    if (dto.isDefault === true && !row.isDefault) {
      await this.priorityRepo.update({ projectId, isDefault: true }, { isDefault: false });
    }

    Object.assign(row, dto);
    const saved = await this.priorityRepo.save(row);
    this.emitConfigEvent('priority', priorityId, projectId, 'updated', { key: saved.key });
    return this.toPriority(saved);
  }

  async deletePriority(projectId: string, priorityId: string): Promise<{ id: string }> {
    await this.ensureProject(projectId);
    const row = await this.priorityRepo.findOne({ where: { id: priorityId, projectId } });
    if (!row) throw new NotFoundException(CONFIG_PRIORITY_NOT_FOUND);

    const taskCount = await this.priorityRepo.manager
      .getRepository('tasks')
      .count({ where: { priorityId } });
    if (taskCount > 0) throw new BadRequestException(CONFIG_PRIORITY_HAS_TASKS);

    await this.priorityRepo.remove(row);
    this.emitConfigEvent('priority', priorityId, projectId, 'deleted');
    return { id: priorityId };
  }

  // ── Severity CRUD ──────────────────────────────────────────────────────────

  async listSeverities(projectId: string): Promise<ProjectSeveritySerializer[]> {
    await this.ensureProject(projectId);
    const rows = await this.severityRepo.find({
      where: { projectId },
      order: { orderIndex: 'ASC' },
    });
    return rows.map((r) => this.toSeverity(r));
  }

  async getSeverity(projectId: string, severityId: string): Promise<ProjectSeveritySerializer> {
    await this.ensureProject(projectId);
    const row = await this.severityRepo.findOne({ where: { id: severityId, projectId } });
    if (!row) throw new NotFoundException(CONFIG_SEVERITY_NOT_FOUND);
    return this.toSeverity(row);
  }

  async createSeverity(
    projectId: string,
    dto: CreateProjectSeverityDto,
  ): Promise<ProjectSeveritySerializer> {
    const project = await this.ensureProject(projectId);
    await this.ensureKeyAvailable(this.severityRepo, projectId, dto.key, CONFIG_SEVERITY_KEY_TAKEN);

    if (dto.isDefault) {
      await this.severityRepo.update({ projectId, isDefault: true }, { isDefault: false });
    }

    const saved = await this.severityRepo.save(
      this.severityRepo.create({
        ...dto,
        projectId,
        project,
        color:      dto.color      ?? '#6B7280',
        orderIndex: dto.orderIndex ?? 0,
        isDefault:  dto.isDefault  ?? false,
      }),
    );
    this.emitConfigEvent('severity', saved.id, projectId, 'created', { key: saved.key });
    return this.toSeverity(saved);
  }

  async updateSeverity(
    projectId: string,
    severityId: string,
    dto: UpdateProjectSeverityDto,
  ): Promise<ProjectSeveritySerializer> {
    await this.ensureProject(projectId);
    const row = await this.severityRepo.findOne({ where: { id: severityId, projectId } });
    if (!row) throw new NotFoundException(CONFIG_SEVERITY_NOT_FOUND);

    if (dto.isDefault === true && !row.isDefault) {
      await this.severityRepo.update({ projectId, isDefault: true }, { isDefault: false });
    }

    Object.assign(row, dto);
    const saved = await this.severityRepo.save(row);
    this.emitConfigEvent('severity', severityId, projectId, 'updated', { key: saved.key });
    return this.toSeverity(saved);
  }

  async deleteSeverity(projectId: string, severityId: string): Promise<{ id: string }> {
    await this.ensureProject(projectId);
    const row = await this.severityRepo.findOne({ where: { id: severityId, projectId } });
    if (!row) throw new NotFoundException(CONFIG_SEVERITY_NOT_FOUND);
    await this.severityRepo.remove(row);
    this.emitConfigEvent('severity', severityId, projectId, 'deleted');
    return { id: severityId };
  }

  // ── Task Type CRUD ─────────────────────────────────────────────────────────

  async listTaskTypes(projectId: string): Promise<ProjectTaskTypeSerializer[]> {
    await this.ensureProject(projectId);
    const rows = await this.taskTypeRepo.find({
      where: { projectId },
      order: { isDefault: 'DESC', name: 'ASC' },
    });
    return rows.map((r) => this.toTaskType(r));
  }

  async getTaskType(projectId: string, typeId: string): Promise<ProjectTaskTypeSerializer> {
    await this.ensureProject(projectId);
    const row = await this.taskTypeRepo.findOne({ where: { id: typeId, projectId } });
    if (!row) throw new NotFoundException(CONFIG_TASK_TYPE_NOT_FOUND);
    return this.toTaskType(row);
  }

  async createTaskType(
    projectId: string,
    dto: CreateProjectTaskTypeDto,
  ): Promise<ProjectTaskTypeSerializer> {
    const project = await this.ensureProject(projectId);
    await this.ensureKeyAvailable(this.taskTypeRepo, projectId, dto.key, CONFIG_TASK_TYPE_KEY_TAKEN);

    if (dto.isDefault) {
      await this.taskTypeRepo.update({ projectId, isDefault: true }, { isDefault: false });
    }

    const saved = await this.taskTypeRepo.save(
      this.taskTypeRepo.create({
        ...dto,
        projectId,
        project,
        icon:          dto.icon          ?? null,
        color:         dto.color         ?? '#6B7280',
        isDefault:     dto.isDefault     ?? false,
        isSubtaskType: dto.isSubtaskType ?? false,
      }),
    );
    this.emitConfigEvent('task-type', saved.id, projectId, 'created', { key: saved.key });
    return this.toTaskType(saved);
  }

  async updateTaskType(
    projectId: string,
    typeId: string,
    dto: UpdateProjectTaskTypeDto,
  ): Promise<ProjectTaskTypeSerializer> {
    await this.ensureProject(projectId);
    const row = await this.taskTypeRepo.findOne({ where: { id: typeId, projectId } });
    if (!row) throw new NotFoundException(CONFIG_TASK_TYPE_NOT_FOUND);

    if (dto.isDefault === true && !row.isDefault) {
      await this.taskTypeRepo.update({ projectId, isDefault: true }, { isDefault: false });
    }

    Object.assign(row, dto);
    const saved = await this.taskTypeRepo.save(row);
    this.emitConfigEvent('task-type', typeId, projectId, 'updated', { key: saved.key });
    return this.toTaskType(saved);
  }

  async deleteTaskType(projectId: string, typeId: string): Promise<{ id: string }> {
    await this.ensureProject(projectId);
    const row = await this.taskTypeRepo.findOne({ where: { id: typeId, projectId } });
    if (!row) throw new NotFoundException(CONFIG_TASK_TYPE_NOT_FOUND);

    const taskCount = await this.taskTypeRepo.manager
      .getRepository('tasks')
      .count({ where: { taskTypeId: typeId } });
    if (taskCount > 0) throw new BadRequestException(CONFIG_TASK_TYPE_HAS_TASKS);

    await this.taskTypeRepo.remove(row);
    this.emitConfigEvent('task-type', typeId, projectId, 'deleted');
    return { id: typeId };
  }

  // ── Label CRUD ─────────────────────────────────────────────────────────────

  async listLabels(projectId: string): Promise<ProjectLabelSerializer[]> {
    await this.ensureProject(projectId);
    const rows = await this.labelRepo.find({
      where: { projectId },
      order: { name: 'ASC' },
    });
    return rows.map((r) => this.toLabel(r));
  }

  async getLabel(projectId: string, labelId: string): Promise<ProjectLabelSerializer> {
    await this.ensureProject(projectId);
    const row = await this.labelRepo.findOne({ where: { id: labelId, projectId } });
    if (!row) throw new NotFoundException(CONFIG_LABEL_NOT_FOUND);
    return this.toLabel(row);
  }

  async createLabel(
    projectId: string,
    dto: CreateProjectLabelDto,
  ): Promise<ProjectLabelSerializer> {
    const project = await this.ensureProject(projectId);
    await this.ensureKeyAvailable(this.labelRepo, projectId, dto.key, CONFIG_LABEL_KEY_TAKEN);

    const saved = await this.labelRepo.save(
      this.labelRepo.create({
        ...dto,
        projectId,
        project,
        color: dto.color ?? '#6B7280',
      }),
    );
    this.emitConfigEvent('label', saved.id, projectId, 'created', { key: saved.key });
    return this.toLabel(saved);
  }

  async updateLabel(
    projectId: string,
    labelId: string,
    dto: UpdateProjectLabelDto,
  ): Promise<ProjectLabelSerializer> {
    await this.ensureProject(projectId);
    const row = await this.labelRepo.findOne({ where: { id: labelId, projectId } });
    if (!row) throw new NotFoundException(CONFIG_LABEL_NOT_FOUND);

    Object.assign(row, dto);
    const saved = await this.labelRepo.save(row);
    this.emitConfigEvent('label', labelId, projectId, 'updated', { key: saved.key });
    return this.toLabel(saved);
  }

  async deleteLabel(projectId: string, labelId: string): Promise<{ id: string }> {
    await this.ensureProject(projectId);
    const row = await this.labelRepo.findOne({ where: { id: labelId, projectId } });
    if (!row) throw new NotFoundException(CONFIG_LABEL_NOT_FOUND);
    await this.labelRepo.remove(row);
    this.emitConfigEvent('label', labelId, projectId, 'deleted');
    return { id: labelId };
  }
}
