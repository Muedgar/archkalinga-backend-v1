import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { EntityManager, Repository } from 'typeorm';
import { User } from 'src/users/entities';
import {
  Task,
  TaskActionType,
  TaskChecklist,
  TaskChecklistItem,
} from '../entities';
import {
  AddChecklistItemDto,
  CreateChecklistGroupDto,
  UpdateChecklistGroupDto,
  UpdateChecklistItemDto,
} from '../dtos';
import {
  TASK_CHECKLIST_GROUP_MISMATCH,
  TASK_CHECKLIST_GROUP_NOT_FOUND,
  TASK_CHECKLIST_ITEM_NOT_FOUND,
} from '../messages';
import {
  TaskChecklistGroupDetailSerializer,
  TaskChecklistItemDetailSerializer,
} from '../serializers';
import { TaskActivityService } from './task-activity.service';
import { TaskRankingService } from './task-ranking.service';

@Injectable()
export class TaskChecklistService {
  constructor(
    @InjectRepository(TaskChecklist)
    private readonly checklistGroupRepo: Repository<TaskChecklist>,
    @InjectRepository(TaskChecklistItem)
    private readonly checklistRepo: Repository<TaskChecklistItem>,
    private readonly activitySvc: TaskActivityService,
    private readonly rankingSvc: TaskRankingService,
  ) {}

  // ── Serializers ───────────────────────────────────────────────────────────

  private serializeItem(item: Partial<TaskChecklistItem>): TaskChecklistItemDetailSerializer {
    return plainToInstance(TaskChecklistItemDetailSerializer, item, {
      excludeExtraneousValues: true,
    });
  }

  private serializeGroup(group: Partial<TaskChecklist>): TaskChecklistGroupDetailSerializer {
    return plainToInstance(TaskChecklistGroupDetailSerializer, group, {
      excludeExtraneousValues: true,
    });
  }

  // ── Private loaders ───────────────────────────────────────────────────────

  private static readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async getItemOrFail(taskId: string, itemId: string): Promise<TaskChecklistItem> {
    if (!TaskChecklistService.UUID_REGEX.test(itemId)) {
      throw new BadRequestException(
        `Invalid checklist item ID "${itemId}". Use the UUID returned by the server when the item was created.`,
      );
    }
    const item = await this.checklistRepo.findOne({ where: { id: itemId, taskId } });
    if (!item) throw new NotFoundException(TASK_CHECKLIST_ITEM_NOT_FOUND);
    return item;
  }

  async getGroupOrFail(taskId: string, groupId: string): Promise<TaskChecklist> {
    const group = await this.checklistGroupRepo.findOne({
      where: { id: groupId },
      relations: ['items'],
    });
    if (!group) throw new NotFoundException(TASK_CHECKLIST_GROUP_NOT_FOUND);
    if (group.taskId !== taskId) throw new NotFoundException(TASK_CHECKLIST_GROUP_MISMATCH);
    return group;
  }

  // ── Reorder helper ────────────────────────────────────────────────────────

  async reorderItems(
    manager: EntityManager,
    taskId: string,
    movingItemId: string | null,
    requestedOrderIndex?: number,
  ): Promise<void> {
    const items = await manager.find(TaskChecklistItem, {
      where: { taskId },
      order: { orderIndex: 'ASC', id: 'ASC' },
    });

    const movingItem = movingItemId
      ? (items.find((item) => item.id === movingItemId) ?? null)
      : null;
    const remaining = movingItem
      ? items.filter((item) => item.id !== movingItemId)
      : [...items];

    const targetIndex =
      requestedOrderIndex === undefined
        ? remaining.length
        : this.rankingSvc.normalizeChecklistOrder(requestedOrderIndex, remaining.length);

    if (movingItem) {
      remaining.splice(targetIndex, 0, movingItem);
    }

    for (const [index, item] of remaining.entries()) {
      if (item.orderIndex !== index) {
        item.orderIndex = index;
        await manager.save(item);
      }
    }
  }

  // ── Checklist items ───────────────────────────────────────────────────────

  async listItems(taskId: string): Promise<TaskChecklistItemDetailSerializer[]> {
    const items = await this.checklistRepo.find({
      where: { taskId },
      order: { orderIndex: 'ASC', id: 'ASC' },
    });
    return items.map((item) => this.serializeItem(item));
  }

  async addItem(
    task: Task,
    actorUser: User,
    dto: AddChecklistItemDto,
  ): Promise<TaskChecklistItemDetailSerializer> {
    return this.checklistRepo.manager.transaction(async (tx) => {
      const item = await tx.save(
        tx.create(TaskChecklistItem, {
          task,
          taskId: task.id,
          text: dto.text.trim(),
          orderIndex: 0,
          completed: false,
          completedByUserId: null,
          completedAt: null,
          checklistGroupId: dto.checklistGroupId ?? null,
        }),
      );

      await this.reorderItems(tx, task.id, item.id, dto.orderIndex ?? 0);
      const saved = await tx.findOneByOrFail(TaskChecklistItem, { id: item.id, taskId: task.id });

      await this.activitySvc.log(tx, task, actorUser, TaskActionType.CHECKLIST_UPDATED, {
        itemId: saved.id,
        operation: 'checklist_item_added',
      });

      return this.serializeItem(saved);
    });
  }

  async updateItem(
    task: Task,
    itemId: string,
    requestUserId: string,
    actorUser: User,
    dto: UpdateChecklistItemDto,
  ): Promise<TaskChecklistItemDetailSerializer> {
    const item = await this.getItemOrFail(task.id, itemId);

    if (dto.text !== undefined)        item.text = dto.text.trim();
    if (dto.orderIndex !== undefined)  item.orderIndex = dto.orderIndex;
    if (dto.completed !== undefined) {
      item.completed = dto.completed;
      item.completedByUserId = dto.completed ? requestUserId : null;
      item.completedAt = dto.completed ? new Date() : null;
    }
    if (dto.checklistGroupId !== undefined) item.checklistGroupId = dto.checklistGroupId ?? null;

    return this.checklistRepo.manager.transaction(async (tx) => {
      const saved = await tx.save(item);
      if (dto.orderIndex !== undefined) {
        await this.reorderItems(tx, task.id, saved.id, dto.orderIndex);
      }
      const refreshed = await tx.findOneByOrFail(TaskChecklistItem, { id: saved.id, taskId: task.id });
      await this.activitySvc.log(tx, task, actorUser, TaskActionType.CHECKLIST_UPDATED, {
        itemId: refreshed.id,
        operation: 'checklist_item_updated',
      });
      return this.serializeItem(refreshed);
    });
  }

  async deleteItem(
    task: Task,
    itemId: string,
    actorUser: User,
  ): Promise<{ id: string; success: true }> {
    const item = await this.getItemOrFail(task.id, itemId);

    await this.checklistRepo.manager.transaction(async (tx) => {
      await tx.remove(item);
      await this.reorderItems(tx, task.id, null);
      await this.activitySvc.log(tx, task, actorUser, TaskActionType.CHECKLIST_UPDATED, {
        itemId,
        operation: 'checklist_item_deleted',
      });
    });

    return { id: itemId, success: true };
  }

  // ── Checklist groups ──────────────────────────────────────────────────────

  async listGroups(taskId: string): Promise<TaskChecklistGroupDetailSerializer[]> {
    const groups = await this.checklistGroupRepo.find({
      where: { taskId },
      relations: ['items'],
      order: { orderIndex: 'ASC', createdAt: 'ASC' },
    });
    return groups.map((g) => this.serializeGroup(g));
  }

  async createGroup(
    task: Task,
    dto: CreateChecklistGroupDto,
  ): Promise<TaskChecklistGroupDetailSerializer> {
    const count = await this.checklistGroupRepo.count({ where: { taskId: task.id } });
    const orderIndex = dto.orderIndex ?? count;

    const group = await this.checklistGroupRepo.save(
      this.checklistGroupRepo.create({
        task,
        taskId: task.id,
        title: dto.title.trim(),
        orderIndex,
      }),
    );

    const withItems = await this.checklistGroupRepo.findOne({
      where: { id: group.id },
      relations: ['items'],
    });

    return this.serializeGroup(withItems ?? group);
  }

  async updateGroup(
    taskId: string,
    groupId: string,
    dto: UpdateChecklistGroupDto,
  ): Promise<TaskChecklistGroupDetailSerializer> {
    const group = await this.getGroupOrFail(taskId, groupId);

    if (dto.title !== undefined)      group.title = dto.title.trim();
    if (dto.orderIndex !== undefined) group.orderIndex = dto.orderIndex;

    await this.checklistGroupRepo.save(group);

    const refreshed = await this.checklistGroupRepo.findOne({
      where: { id: group.id },
      relations: ['items'],
    });

    return this.serializeGroup(refreshed ?? group);
  }

  async deleteGroup(taskId: string, groupId: string): Promise<{ id: string; success: true }> {
    const group = await this.getGroupOrFail(taskId, groupId);
    await this.checklistGroupRepo.remove(group);
    return { id: groupId, success: true };
  }
}
