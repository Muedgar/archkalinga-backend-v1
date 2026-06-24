import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Repository } from 'typeorm';
import {
  CreateTaskResourceAllocationDto,
  UpdateTaskResourceAllocationDto,
} from '../dtos';
import { Task, TaskResourceAllocation } from '../entities';
import { TASK_RESOURCE_ALLOCATION_NOT_FOUND } from '../messages';
import { TaskResourceReportRowSerializer } from '../serializers';

@Injectable()
export class TaskResourceAllocationService {
  constructor(
    @InjectRepository(TaskResourceAllocation)
    private readonly allocationRepo: Repository<TaskResourceAllocation>,
  ) {}

  async listForTask(taskId: string): Promise<TaskResourceReportRowSerializer[]> {
    const rows = await this.allocationRepo.find({
      where: { taskId },
      order: {
        phaseCode: 'ASC',
        stageCode: 'ASC',
        activityCode: 'ASC',
        resourceType: 'ASC',
        resourceName: 'ASC',
        createdAt: 'ASC',
      },
    });
    return rows.map((row) => this.serialize(row));
  }

  async getForTask(
    taskId: string,
    allocationId: string,
  ): Promise<TaskResourceReportRowSerializer> {
    const allocation = await this.findForTask(taskId, allocationId);
    return this.serialize(allocation);
  }

  async createForTask(
    task: Task,
    dto: CreateTaskResourceAllocationDto,
  ): Promise<TaskResourceReportRowSerializer> {
    const allocation = this.allocationRepo.create({
      task,
      taskId: task.id,
      phaseCode: this.clean(dto.phaseCode),
      phaseName: this.clean(dto.phaseName),
      stageCode: this.clean(dto.stageCode),
      stageName: this.clean(dto.stageName),
      activityCode: this.clean(dto.activityCode) ?? task.wbsCode,
      activityName: this.clean(dto.activityName) ?? task.title,
      resourceType: dto.resourceType.trim(),
      resourceName: dto.resourceName.trim(),
      quantity: dto.quantity,
      durationDays: dto.durationDays ?? null,
      defaultRate: dto.defaultRate ?? null,
      overrideRate: dto.overrideRate ?? null,
      effectiveRate: dto.effectiveRate ?? null,
      costAmount: dto.costAmount ?? null,
      currency: dto.currency?.trim().toUpperCase() ?? 'RWF',
      status: this.clean(dto.status),
    });
    const saved = await this.allocationRepo.save(allocation);
    return this.serialize(saved);
  }

  async updateForTask(
    taskId: string,
    allocationId: string,
    dto: UpdateTaskResourceAllocationDto,
  ): Promise<TaskResourceReportRowSerializer> {
    const allocation = await this.findForTask(taskId, allocationId);

    if (dto.phaseCode !== undefined) {
      allocation.phaseCode = this.clean(dto.phaseCode);
    }
    if (dto.phaseName !== undefined) {
      allocation.phaseName = this.clean(dto.phaseName);
    }
    if (dto.stageCode !== undefined) {
      allocation.stageCode = this.clean(dto.stageCode);
    }
    if (dto.stageName !== undefined) {
      allocation.stageName = this.clean(dto.stageName);
    }
    if (dto.activityCode !== undefined) {
      allocation.activityCode = this.clean(dto.activityCode);
    }
    if (dto.activityName !== undefined) {
      allocation.activityName = this.clean(dto.activityName);
    }
    if (dto.resourceType !== undefined) {
      allocation.resourceType = dto.resourceType.trim();
    }
    if (dto.resourceName !== undefined) {
      allocation.resourceName = dto.resourceName.trim();
    }
    if (dto.quantity !== undefined) allocation.quantity = dto.quantity;
    if (dto.durationDays !== undefined) {
      allocation.durationDays = dto.durationDays ?? null;
    }
    if (dto.defaultRate !== undefined) {
      allocation.defaultRate = dto.defaultRate ?? null;
    }
    if (dto.overrideRate !== undefined) {
      allocation.overrideRate = dto.overrideRate ?? null;
    }
    if (dto.effectiveRate !== undefined) {
      allocation.effectiveRate = dto.effectiveRate ?? null;
    }
    if (dto.costAmount !== undefined) {
      allocation.costAmount = dto.costAmount ?? null;
    }
    if (dto.currency !== undefined) {
      allocation.currency = dto.currency?.trim().toUpperCase() ?? 'RWF';
    }
    if (dto.status !== undefined) allocation.status = this.clean(dto.status);

    const saved = await this.allocationRepo.save(allocation);
    return this.serialize(saved);
  }

  async deleteForTask(taskId: string, allocationId: string) {
    const allocation = await this.findForTask(taskId, allocationId);
    await this.allocationRepo.delete({ id: allocation.id });
    return { id: allocation.id, deleted: true };
  }

  private async findForTask(
    taskId: string,
    allocationId: string,
  ): Promise<TaskResourceAllocation> {
    const allocation = await this.allocationRepo.findOne({
      where: { id: allocationId, taskId },
    });
    if (!allocation) {
      throw new NotFoundException(TASK_RESOURCE_ALLOCATION_NOT_FOUND);
    }
    return allocation;
  }

  private clean(value: string | null | undefined): string | null {
    const cleaned = value?.trim();
    return cleaned || null;
  }

  private serialize(
    allocation: TaskResourceAllocation,
  ): TaskResourceReportRowSerializer {
    return plainToInstance(TaskResourceReportRowSerializer, allocation, {
      excludeExtraneousValues: true,
    });
  }
}
