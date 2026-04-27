import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { User } from 'src/users/entities';
import { Task, TaskActionType, TaskComment } from '../entities';
import { AddCommentDto, UpdateCommentDto } from '../dtos';
import {
  TASK_COMMENT_ACCESS_DENIED,
  TASK_COMMENT_NOT_FOUND,
} from '../messages';
import { TaskCommentDetailSerializer } from '../serializers';
import { TaskActivityService } from './task-activity.service';

@Injectable()
export class TaskCommentsService {
  constructor(
    @InjectRepository(TaskComment)
    private readonly commentRepo: Repository<TaskComment>,
    private readonly activitySvc: TaskActivityService,
  ) {}

  // ── Serializer ────────────────────────────────────────────────────────────

  private serialize(comment: Partial<TaskComment>): TaskCommentDetailSerializer {
    return plainToInstance(TaskCommentDetailSerializer, comment, {
      excludeExtraneousValues: true,
    });
  }

  // ── Private loader ────────────────────────────────────────────────────────

  async getCommentOrFail(taskId: string, commentId: string): Promise<TaskComment> {
    const comment = await this.commentRepo.findOne({
      where: { id: commentId, taskId, deletedAt: IsNull() },
    });
    if (!comment) throw new NotFoundException(TASK_COMMENT_NOT_FOUND);
    return comment;
  }

  // ── Public API (called by TasksService after auth is verified) ────────────

  async listComments(taskId: string): Promise<TaskCommentDetailSerializer[]> {
    const comments = await this.commentRepo.find({
      where: { taskId, deletedAt: IsNull() },
      relations: ['authorUser'],
      order: { createdAt: 'ASC' },
    });
    return comments.map((c) => this.serialize(c));
  }

  async addComment(
    task: Task,
    actorUser: User,
    dto: AddCommentDto,
  ): Promise<TaskCommentDetailSerializer> {
    if (dto.parentCommentId) {
      await this.getCommentOrFail(task.id, dto.parentCommentId);
    }

    return this.commentRepo.manager.transaction(async (tx) => {
      const comment = await tx.save(
        tx.create(TaskComment, {
          task,
          taskId: task.id,
          authorUser: actorUser,
          authorUserId: actorUser.id,
          body: dto.body.trim(),
          parentCommentId: dto.parentCommentId ?? null,
          deletedAt: null,
        }),
      );

      await this.activitySvc.log(tx, task, actorUser, TaskActionType.COMMENT_ADDED, {
        commentId: comment.id,
      });

      return this.serialize({ ...comment, authorUser: actorUser });
    });
  }

  async updateComment(
    task: Task,
    commentId: string,
    requestUserId: string,
    actorUser: User,
    dto: UpdateCommentDto,
  ): Promise<TaskCommentDetailSerializer> {
    const comment = await this.getCommentOrFail(task.id, commentId);

    if (comment.authorUserId !== requestUserId) {
      throw new ForbiddenException(TASK_COMMENT_ACCESS_DENIED);
    }

    if (dto.body !== undefined) {
      comment.body = dto.body.trim();
    }

    return this.commentRepo.manager.transaction(async (tx) => {
      const saved = await tx.save(comment);
      await this.activitySvc.log(tx, task, actorUser, TaskActionType.TASK_UPDATED, {
        commentId: saved.id,
        operation: 'comment_updated',
      });
      return this.serialize({ ...saved, authorUser: actorUser });
    });
  }

  async deleteComment(
    task: Task,
    commentId: string,
    requestUserId: string,
    actorUser: User,
  ): Promise<{ id: string; success: true }> {
    const comment = await this.getCommentOrFail(task.id, commentId);

    if (comment.authorUserId !== requestUserId) {
      throw new ForbiddenException(TASK_COMMENT_ACCESS_DENIED);
    }

    await this.commentRepo.manager.transaction(async (tx: EntityManager) => {
      comment.deletedAt = new Date();
      await tx.save(comment);
      await this.activitySvc.log(tx, task, actorUser, TaskActionType.TASK_UPDATED, {
        commentId: comment.id,
        operation: 'comment_deleted',
      });
    });

    return { id: commentId, success: true };
  }
}
