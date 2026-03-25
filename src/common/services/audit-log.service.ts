import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';

export interface CreateAuditLogDto {
  actorId?: string;
  organizationId?: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  payload?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

  /**
   * Persist a new audit log entry. Fire-and-forget safe — errors are
   * swallowed to prevent audit logging from breaking the primary request.
   */
  async log(dto: CreateAuditLogDto): Promise<void> {
    try {
      const log = this.auditLogRepo.create({
        actor: dto.actorId ? ({ id: dto.actorId } as any) : null,
        organization: dto.organizationId ? ({ id: dto.organizationId } as any) : null,
        action: dto.action,
        resource: dto.resource,
        resourceId: dto.resourceId ?? null,
        payload: dto.payload ?? null,
        result: dto.result ?? null,
        ipAddress: dto.ipAddress ?? null,
      });
      await this.auditLogRepo.save(log);
    } catch {
      // Audit logging must never break the main request flow.
    }
  }

  /**
   * Retrieve audit logs for a specific organization, newest first.
   * @param organizationId  The organization's UUID.
   * @param limit           Page size (default 50, max 200).
   * @param offset          Pagination offset (default 0).
   */
  async findAll(
    organizationId: string,
    limit = 50,
    offset = 0,
  ): Promise<[AuditLog[], number]> {
    return this.auditLogRepo.findAndCount({
      where: { organization: { id: organizationId } },
      relations: ['actor'],
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 200),
      skip: offset,
    });
  }
}
