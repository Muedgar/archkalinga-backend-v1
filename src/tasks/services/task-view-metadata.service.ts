import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { BulkTaskViewMetadataDto } from '../dtos';
import { Task, TaskViewMetadata } from '../entities';
import { TASK_NOT_FOUND } from '../messages';
import { TaskAuthService } from './task-auth.service';

@Injectable()
export class TaskViewMetadataService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(TaskViewMetadata)
    private readonly viewMetadataRepo: Repository<TaskViewMetadata>,
    private readonly authSvc: TaskAuthService,
  ) {}

  async bulkSave(
    projectId: string,
    dto: BulkTaskViewMetadataDto,
    requestUser: RequestUser,
  ) {
    const taskIds = dto.items.map((item) => item.taskId);
    const uniqueTaskIds = [...new Set(taskIds)];
    if (uniqueTaskIds.length !== taskIds.length) {
      throw new BadRequestException(
        'Each task can appear only once in a layout save payload',
      );
    }

    const canViewAllProjectTasks = await this.authSvc.canViewAllProjectTasks(
      projectId,
      requestUser,
    );
    const taskQb = this.taskRepo
      .createQueryBuilder('task')
      .where('task.id IN (:...taskIds)', { taskIds: uniqueTaskIds })
      .andWhere('task.projectId = :projectId', { projectId })
      .andWhere('task.deletedAt IS NULL')
      .andWhere('task.supersededByTaskId IS NULL');
    this.authSvc.applyTaskVisibilityScope(
      taskQb,
      requestUser,
      canViewAllProjectTasks,
    );
    const tasks = await taskQb.getMany();
    if (tasks.length !== uniqueTaskIds.length) {
      throw new BadRequestException(TASK_NOT_FOUND);
    }

    const rowsToSave = dto.items.map((item) => ({
      taskId: item.taskId,
      viewType: dto.viewType,
      metaJson: item.meta,
    }));
    await this.viewMetadataRepo.upsert(rowsToSave as any, [
      'taskId',
      'viewType',
    ]);

    return {
      meta: {
        projectId,
        viewType: dto.viewType,
        updated: rowsToSave.length,
        generatedAt: new Date().toISOString(),
      },
      summary: {
        accepted: rowsToSave.length,
        rejected: 0,
      },
      data: {
        items: rowsToSave.map((row) => ({
          taskId: row.taskId,
          viewType: row.viewType,
          meta: row.metaJson ?? {},
        })),
      },
    };
  }
}
