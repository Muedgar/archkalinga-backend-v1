import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Brackets, Repository } from 'typeorm';
import { FilterResponse } from 'src/common/interfaces';
import { User } from 'src/users/entities';
import {
  CreateTaskMaterialDto,
  TaskMaterialFiltersDto,
  UpdateTaskMaterialDto,
} from '../dtos';
import { Task, TaskActionType, TaskMaterial } from '../entities';
import { TASK_MATERIAL_NOT_FOUND } from '../messages';
import { TaskMaterialSerializer } from '../serializers';
import { TaskActivityService } from './task-activity.service';

@Injectable()
export class TaskMaterialsService {
  constructor(
    @InjectRepository(TaskMaterial)
    private readonly materialRepo: Repository<TaskMaterial>,
    private readonly activitySvc: TaskActivityService,
  ) {}

  async listTaskMaterials(
    taskId: string,
    filters: TaskMaterialFiltersDto,
  ): Promise<FilterResponse<TaskMaterialSerializer>> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 100;
    const qb = this.materialRepo
      .createQueryBuilder('material')
      .where('material.taskId = :taskId', { taskId });

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

    qb.orderBy('material.phaseCode', 'ASC', 'NULLS LAST')
      .addOrderBy('material.stageCode', 'ASC', 'NULLS LAST')
      .addOrderBy('material.activityCode', 'ASC', 'NULLS LAST')
      .addOrderBy('material.taskCode', 'ASC', 'NULLS LAST')
      .addOrderBy('material.materialCategory', 'ASC')
      .addOrderBy('material.materialName', 'ASC')
      .addOrderBy('material.createdAt', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, count] = await qb.getManyAndCount();

    return {
      items: items.map((item) => this.serialize(item)),
      count,
      pages: Math.ceil(count / limit),
      previousPage: page > 1 ? page - 1 : null,
      page,
      nextPage: count / limit > page ? page + 1 : null,
      limit,
    };
  }

  async createTaskMaterial(
    task: Task,
    actorUser: User,
    dto: CreateTaskMaterialDto,
  ): Promise<TaskMaterialSerializer> {
    return this.materialRepo.manager.transaction(async (tx) => {
      const material = await tx.save(
        tx.create(TaskMaterial, {
          task,
          taskId: task.id,
          ...this.toMaterialValues(dto),
        }),
      );

      await this.activitySvc.log(tx, task, actorUser, TaskActionType.TASK_UPDATED, {
        materialId: material.id,
        operation: 'task_material_created',
      });

      return this.serialize(material);
    });
  }

  async getTaskMaterial(
    taskId: string,
    materialId: string,
  ): Promise<TaskMaterialSerializer> {
    return this.serialize(await this.getTaskMaterialOrFail(taskId, materialId));
  }

  async updateTaskMaterial(
    task: Task,
    materialId: string,
    actorUser: User,
    dto: UpdateTaskMaterialDto,
  ): Promise<TaskMaterialSerializer> {
    const material = await this.getTaskMaterialOrFail(task.id, materialId);
    Object.assign(material, this.toMaterialValues(dto));

    return this.materialRepo.manager.transaction(async (tx) => {
      const saved = await tx.save(material);

      await this.activitySvc.log(tx, task, actorUser, TaskActionType.TASK_UPDATED, {
        materialId: saved.id,
        operation: 'task_material_updated',
      });

      return this.serialize(saved);
    });
  }

  async deleteTaskMaterial(
    task: Task,
    materialId: string,
    actorUser: User,
  ): Promise<{ id: string; success: true }> {
    const material = await this.getTaskMaterialOrFail(task.id, materialId);

    await this.materialRepo.manager.transaction(async (tx) => {
      await tx.remove(material);
      await this.activitySvc.log(tx, task, actorUser, TaskActionType.TASK_UPDATED, {
        materialId,
        operation: 'task_material_deleted',
      });
    });

    return { id: materialId, success: true };
  }

  async getTaskMaterialOrFail(
    taskId: string,
    materialId: string,
  ): Promise<TaskMaterial> {
    const material = await this.materialRepo.findOne({
      where: { id: materialId, taskId },
    });

    if (!material) throw new NotFoundException(TASK_MATERIAL_NOT_FOUND);
    return material;
  }

  private serialize(material: Partial<TaskMaterial>): TaskMaterialSerializer {
    return plainToInstance(TaskMaterialSerializer, material, {
      excludeExtraneousValues: true,
    });
  }

  private toMaterialValues(
    dto: CreateTaskMaterialDto | UpdateTaskMaterialDto,
  ): Partial<TaskMaterial> {
    const values: Partial<TaskMaterial> = {};

    this.assignString(values, 'phaseCode', dto.phaseCode);
    this.assignString(values, 'stageCode', dto.stageCode);
    this.assignString(values, 'activityCode', dto.activityCode);
    this.assignString(values, 'activityName', dto.activityName);
    this.assignString(values, 'taskCode', dto.taskCode);
    this.assignString(values, 'taskName', dto.taskName);
    this.assignString(values, 'materialCategory', dto.materialCategory);
    this.assignString(values, 'materialName', dto.materialName);
    this.assignString(values, 'unit', dto.unit);
    this.assignString(values, 'currency', dto.currency);
    this.assignString(values, 'lookupStatus', dto.lookupStatus);

    if (dto.quantity !== undefined) values.quantity = dto.quantity;
    if (dto.defaultRate !== undefined) values.defaultRate = dto.defaultRate;
    if (dto.wastePercent !== undefined) values.wastePercent = dto.wastePercent;
    if (dto.materialCost !== undefined) values.materialCost = dto.materialCost;

    return values;
  }

  private assignString<K extends keyof TaskMaterial>(
    values: Partial<TaskMaterial>,
    key: K,
    value: string | null | undefined,
  ): void {
    if (value === undefined) return;
    values[key] = (value === null ? null : value.trim()) as TaskMaterial[K];
  }
}
