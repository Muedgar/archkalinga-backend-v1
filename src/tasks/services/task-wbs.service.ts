import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Task, TaskWbsCode } from '../entities';

type TaskWbsAssignment = {
  wbsCode: string | null;
  wbsSortKey: string | null;
};

@Injectable()
export class TaskWbsService {
  normalizeCode(value: string | null | undefined): string | null {
    const cleaned = value?.trim();
    if (!cleaned) return null;
    return cleaned.replace(/\.0+$/, '');
  }

  toWbsSortKey(code: string): string {
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

  prepareAssignment(
    requestedWbsCode: string | null | undefined,
    requestedWbsSortKey?: string | null,
  ): TaskWbsAssignment {
    const wbsCode = this.normalizeCode(requestedWbsCode);
    if (!wbsCode) {
      return {
        wbsCode: null,
        wbsSortKey: requestedWbsSortKey?.trim() || null,
      };
    }

    return {
      wbsCode,
      wbsSortKey: this.toWbsSortKey(wbsCode),
    };
  }

  async applyTaskAssignment(
    manager: EntityManager,
    task: Pick<Task, 'id' | 'projectId' | 'wbsCode' | 'wbsSortKey'>,
    requestedWbsCode: string | null | undefined,
    requestedWbsSortKey: string | null | undefined,
    actorUserId: string | null,
  ): Promise<boolean> {
    if (requestedWbsCode === undefined && requestedWbsSortKey === undefined) {
      return false;
    }

    const next = this.prepareAssignment(
      requestedWbsCode === undefined ? task.wbsCode : requestedWbsCode,
      requestedWbsSortKey,
    );

    if (!next.wbsCode) {
      if (task.wbsCode) {
        throw new BadRequestException(
          'WBS codes are permanent once assigned and cannot be cleared.',
        );
      }
      task.wbsCode = null;
      task.wbsSortKey = next.wbsSortKey;
      return true;
    }

    await this.reserveCode(
      manager,
      task.projectId,
      task.id,
      next.wbsCode,
      next.wbsSortKey!,
      actorUserId,
    );

    task.wbsCode = next.wbsCode;
    task.wbsSortKey = next.wbsSortKey;
    return true;
  }

  async reserveExistingTaskCode(
    manager: EntityManager,
    task: Pick<Task, 'id' | 'projectId' | 'wbsCode' | 'wbsSortKey'>,
    actorUserId: string | null,
  ): Promise<void> {
    const wbsCode = this.normalizeCode(task.wbsCode);
    if (!wbsCode) return;

    const wbsSortKey = task.wbsSortKey?.trim() || this.toWbsSortKey(wbsCode);
    await this.reserveCode(
      manager,
      task.projectId,
      task.id,
      wbsCode,
      wbsSortKey,
      actorUserId,
    );
    task.wbsCode = wbsCode;
    task.wbsSortKey = wbsSortKey;
  }

  private async reserveCode(
    manager: EntityManager,
    projectId: string,
    taskId: string,
    wbsCode: string,
    wbsSortKey: string,
    actorUserId: string | null,
  ): Promise<void> {
    const existing = await manager.findOne(TaskWbsCode, {
      where: { projectId, wbsCode },
    });

    if (existing) {
      if (existing.taskId !== taskId) {
        throw new BadRequestException(
          `WBS code "${wbsCode}" has already been assigned and cannot be reused.`,
        );
      }
      if (existing.wbsSortKey !== wbsSortKey) {
        existing.wbsSortKey = wbsSortKey;
        await manager.save(TaskWbsCode, existing);
      }
      return;
    }

    await manager.save(
      manager.create(TaskWbsCode, {
        projectId,
        taskId,
        wbsCode,
        wbsSortKey,
        assignedByUserId: actorUserId,
      }),
    );
  }
}
