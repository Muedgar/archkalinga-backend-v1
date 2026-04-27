import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { Task } from '../entities';
import { INVALID_TASK_HIERARCHY, INVALID_TASK_MOVE_TARGET } from '../messages';

// ── Rank constants ────────────────────────────────────────────────────────────

const RANK_WIDTH = 10;
const RANK_BASE  = 36n;
const RANK_STEP  = 1024n;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TaskScope {
  projectId: string;
  parentTaskId: string | null;
  statusId: string | null;
}

@Injectable()
export class TaskRankingService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
  ) {}

  // ── Clamping helpers ──────────────────────────────────────────────────────

  normalizeColumnOrder(requested: number | undefined, siblingCount: number): number {
    if (requested === undefined) return siblingCount;
    return Math.max(0, Math.min(requested, siblingCount));
  }

  normalizeChecklistOrder(requested: number, siblingCount: number): number {
    return Math.max(0, Math.min(requested, siblingCount));
  }

  // ── Scope helpers ─────────────────────────────────────────────────────────

  buildScope(projectId: string, parentTaskId: string | null, statusId: string | null): TaskScope {
    return { projectId, parentTaskId, statusId };
  }

  scopeWhere(scope: TaskScope): FindOptionsWhere<Task> {
    return {
      projectId: scope.projectId,
      deletedAt: IsNull(),
      parentTaskId: scope.parentTaskId ?? IsNull(),
      statusId: scope.statusId ?? IsNull(),
    };
  }

  async getScopedTasks(
    manager: EntityManager,
    scope: TaskScope,
    excludeTaskId?: string,
  ): Promise<Task[]> {
    const tasks = await manager.find(Task, {
      where: this.scopeWhere(scope),
      order: { rank: 'ASC', createdAt: 'ASC' },
    });
    return excludeTaskId ? tasks.filter((t) => t.id !== excludeTaskId) : tasks;
  }

  // ── Rank encoding ─────────────────────────────────────────────────────────

  parseRankValue(rank?: string | null): bigint | null {
    if (!rank || !/^[0-9a-z]+$/i.test(rank)) return null;
    let result = 0n;
    for (const char of rank.toLowerCase()) {
      result = result * RANK_BASE + BigInt(parseInt(char, 36));
    }
    return result;
  }

  formatRankValue(value: bigint): string {
    if (value < 0n) return '0'.repeat(RANK_WIDTH);
    return value.toString(36).padStart(RANK_WIDTH, '0').slice(-RANK_WIDTH);
  }

  // ── Rebalance ─────────────────────────────────────────────────────────────

  async rebalanceScopeRanks(
    manager: EntityManager,
    scope: TaskScope,
    excludeTaskId?: string,
  ): Promise<Map<string, string>> {
    const tasks = await this.getScopedTasks(manager, scope, excludeTaskId);
    const rankMap = new Map<string, string>();

    let current = RANK_STEP;
    for (const sibling of tasks) {
      const nextRank = this.formatRankValue(current);
      if (sibling.rank !== nextRank) {
        sibling.rank = nextRank;
        await manager.save(sibling);
      }
      rankMap.set(sibling.id, nextRank);
      current += RANK_STEP;
    }

    return rankMap;
  }

  // ── Calculate rank for a given position ──────────────────────────────────

  async calculateRankWithinScope(
    manager: EntityManager,
    scope: TaskScope,
    beforeTaskId?: string,
    afterTaskId?: string,
    excludeTaskId?: string,
  ): Promise<string> {
    const siblings = await this.getScopedTasks(manager, scope, excludeTaskId);
    const siblingIds = new Set(siblings.map((s) => s.id));

    if (beforeTaskId && !siblingIds.has(beforeTaskId)) throw new BadRequestException(INVALID_TASK_MOVE_TARGET);
    if (afterTaskId  && !siblingIds.has(afterTaskId))  throw new BadRequestException(INVALID_TASK_MOVE_TARGET);
    if (beforeTaskId && afterTaskId && beforeTaskId === afterTaskId) throw new BadRequestException(INVALID_TASK_MOVE_TARGET);

    if (beforeTaskId && afterTaskId) {
      const beforeIndex = siblings.findIndex((s) => s.id === beforeTaskId);
      const afterIndex  = siblings.findIndex((s) => s.id === afterTaskId);
      if (beforeIndex === -1 || afterIndex === -1 || afterIndex + 1 !== beforeIndex) {
        throw new BadRequestException(INVALID_TASK_MOVE_TARGET);
      }
    }

    const beforeRank = this.parseRankValue(
      beforeTaskId ? siblings.find((s) => s.id === beforeTaskId)?.rank : null,
    );
    const afterRank = this.parseRankValue(
      afterTaskId  ? siblings.find((s) => s.id === afterTaskId)?.rank  : null,
    );

    if (beforeRank !== null && afterRank !== null) {
      if (beforeRank - afterRank > 1n) {
        return this.formatRankValue((beforeRank + afterRank) / 2n);
      }
      await this.rebalanceScopeRanks(manager, scope, excludeTaskId);
      return this.calculateRankWithinScope(manager, scope, beforeTaskId, afterTaskId, excludeTaskId);
    }

    if (beforeRank !== null) {
      if (beforeRank > 1n) return this.formatRankValue(beforeRank / 2n);
      await this.rebalanceScopeRanks(manager, scope, excludeTaskId);
      return this.calculateRankWithinScope(manager, scope, beforeTaskId, afterTaskId, excludeTaskId);
    }

    if (afterRank !== null) return this.formatRankValue(afterRank + RANK_STEP);

    const last = siblings[siblings.length - 1];
    if (!last) return this.formatRankValue(RANK_STEP);

    const lastRank = this.parseRankValue(last.rank) ?? 0n;
    return this.formatRankValue(lastRank + RANK_STEP);
  }

  // ── Convenience: rank at end of scope ────────────────────────────────────

  async getNextRank(
    manager: EntityManager,
    projectId: string,
    parentTaskId?: string | null,
    statusId?: string | null,
  ): Promise<string> {
    return this.calculateRankWithinScope(
      manager,
      this.buildScope(projectId, parentTaskId ?? null, statusId ?? null),
    );
  }

  // ── Prevent circular parent assignment ───────────────────────────────────

  async assertNotDescendant(
    projectId: string,
    taskId: string,
    targetParentTaskId: string | null,
  ): Promise<void> {
    if (!targetParentTaskId) return;
    if (targetParentTaskId === taskId) throw new BadRequestException(INVALID_TASK_HIERARCHY);

    const tasks = await this.taskRepo.find({
      where: { projectId, deletedAt: IsNull() },
      select: ['id', 'parentTaskId'],
    });

    const queue = [taskId];
    const descendants = new Set<string>([taskId]);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      for (const candidate of tasks) {
        if (candidate.parentTaskId === currentId && !descendants.has(candidate.id)) {
          descendants.add(candidate.id);
          queue.push(candidate.id);
        }
      }
    }

    if (descendants.has(targetParentTaskId)) throw new BadRequestException(INVALID_TASK_HIERARCHY);
  }
}
