import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { randomUUID } from 'crypto';
import { FindManyOptions, Repository } from 'typeorm';
import { ListFilterDTO } from 'src/common/dtos';
import { FilterResponse } from 'src/common/interfaces';
import { ListFilterService } from 'src/common/services';
import { Workspace } from 'src/workspaces/entities/workspace.entity';
import { Project } from 'src/projects/entities';
import { CreateTemplateDto, UpdateTemplateDto } from './dtos';
import {
  TEMPLATE_EXISTS,
  TEMPLATE_IN_USE,
  TEMPLATE_NOT_FOUND,
} from './messages';
import { Template, TemplateTask } from './entities';
import { TemplateSerializer } from './serializers';

@Injectable()
export class TemplatesService {
  constructor(
    @InjectRepository(Template)
    private readonly templateRepo: Repository<Template>,
    @InjectRepository(TemplateTask)
    private readonly templateTaskRepo: Repository<TemplateTask>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Workspace)
    private readonly workspaceRepo: Repository<Workspace>,
    private readonly listFilterService: ListFilterService,
  ) {}

  private normalizeName(name: string): string {
    return name.trim();
  }

  private withRelations(): FindManyOptions<Template> {
    return {
      relations: ['tasks'],
      order: {
        createdAt: 'DESC',
        tasks: { order: 'ASC' },
      },
    };
  }

  private async ensureNameFree(
    name: string,
    workspaceId: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.templateRepo.findOne({
      where: { name, workspaceId },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(TEMPLATE_EXISTS);
    }
  }

  private async loadOne(where: {
    id?: string;
    name?: string;
    workspaceId: string;
  }): Promise<Template> {
    const template = await this.templateRepo.findOne({
      where,
      relations: ['tasks'],
      order: { tasks: { order: 'ASC' } },
    });
    if (!template) throw new NotFoundException(TEMPLATE_NOT_FOUND);
    return template;
  }

  private toSerializer(template: Template): TemplateSerializer {
    return plainToInstance(TemplateSerializer, template, {
      excludeExtraneousValues: true,
    });
  }

  private buildTaskEntities(
    tasks: CreateTemplateDto['tasks'],
    template: Template,
    parentTask: TemplateTask | null = null,
  ): TemplateTask[] {
    return tasks.flatMap((task, index) => {
      const templateTask = this.templateTaskRepo.create({
        id: randomUUID(),
        name: task.name.trim(),
        description: task.description.trim(),
        order: index + 1,
        template,
        templateId: template.id,
        parentTask,
        parentTaskId: parentTask?.id ?? null,
      });

      return [
        templateTask,
        ...this.buildTaskEntities(task.subtasks ?? [], template, templateTask),
      ];
    });
  }

  async createTemplate(
    dto: CreateTemplateDto,
    workspaceId: string,
  ): Promise<TemplateSerializer> {
    const name = this.normalizeName(dto.name);
    await this.ensureNameFree(name, workspaceId);

    // Load workspace record to resolve the integer FK via TypeORM relation
    const workspaceRecord = await this.workspaceRepo.findOneOrFail({ where: { id: workspaceId } });

    const saved = await this.templateRepo.manager.transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.update(Template, { workspaceId, isDefault: true }, { isDefault: false });
      }

      const template = tx.create(Template, {
        workspace: workspaceRecord,
        workspaceId,
        name,
        description: dto.description.trim(),
        isDefault: dto.isDefault,
      });

      const savedTemplate = await tx.save(template);
      const tasks = this.buildTaskEntities(dto.tasks, savedTemplate);
      await tx.save(tasks);
      return savedTemplate;
    });

    return this.toSerializer(await this.loadOne({ id: saved.id, workspaceId }));
  }

  async getTemplates(
    filters: ListFilterDTO,
    workspaceId: string,
  ): Promise<FilterResponse<TemplateSerializer>> {
    return this.listFilterService.filter({
      repository: this.templateRepo,
      serializer: TemplateSerializer,
      filters,
      searchFields: ['name', 'description'],
      options: {
        ...this.withRelations(),
        where: { workspaceId },
      } as FindManyOptions<Template>,
    });
  }

  async getTemplateByIdentifier(
    identifier: string,
    workspaceId: string,
  ): Promise<TemplateSerializer> {
    const template = await this.findTemplateByIdentifier(identifier, workspaceId);
    return this.toSerializer(template);
  }

  async updateTemplateByIdentifier(
    identifier: string,
    dto: UpdateTemplateDto,
    workspaceId: string,
  ): Promise<TemplateSerializer> {
    const template = await this.findTemplateByIdentifier(identifier, workspaceId);

    if (dto.name !== undefined) {
      const name = this.normalizeName(dto.name);
      await this.ensureNameFree(name, workspaceId, template.id);
      template.name = name;
    }

    if (dto.description !== undefined) {
      template.description = dto.description.trim();
    }

    const shouldReplaceTasks = dto.tasks !== undefined;
    const shouldBecomeDefault = dto.isDefault === true;
    const shouldUnsetDefault  = dto.isDefault === false;

    const updated = await this.templateRepo.manager.transaction(async (tx) => {
      if (shouldBecomeDefault) {
        await tx.update(Template, { workspaceId, isDefault: true }, { isDefault: false });
        template.isDefault = true;
      } else if (shouldUnsetDefault) {
        template.isDefault = false;
      }

      await tx.save(template);

      if (shouldReplaceTasks) {
        await tx.delete(TemplateTask, { templateId: template.id });

        if (dto.tasks && dto.tasks.length > 0) {
          const tasks = this.buildTaskEntities(dto.tasks, template);
          await tx.save(tasks);
        }
      }

      return template;
    });

    return this.toSerializer(await this.loadOne({ id: updated.id, workspaceId }));
  }

  async deleteTemplateByIdentifier(
    identifier: string,
    workspaceId: string,
  ): Promise<void> {
    const template = await this.findTemplateByIdentifier(identifier, workspaceId);
    const projectCount = await this.projectRepo.count({
      where: { templateId: template.id, workspaceId },
    });

    if (projectCount > 0) {
      throw new ConflictException(TEMPLATE_IN_USE);
    }

    await this.templateRepo.manager.transaction(async (tx) => {
      await tx.delete(TemplateTask, { templateId: template.id });
      await tx.delete(Template, { id: template.id, workspaceId });
    });
  }

  private async findTemplateByIdentifier(
    identifier: string,
    workspaceId: string,
  ): Promise<Template> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        identifier,
      );

    if (isUuid) {
      const byId = await this.templateRepo.findOne({
        where: { id: identifier, workspaceId },
        relations: ['tasks'],
        order: { tasks: { order: 'ASC' } },
      });
      if (byId) return byId;
    }

    const byName = await this.templateRepo.findOne({
      where: { name: identifier, workspaceId },
      relations: ['tasks'],
      order: { tasks: { order: 'ASC' } },
    });
    if (!byName) throw new NotFoundException(TEMPLATE_NOT_FOUND);
    return byName;
  }
}
