import { Expose } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

// ── Status ────────────────────────────────────────────────────────────────────

export class ProjectStatusSerializer extends BaseSerializer {
  @Expose() projectId: string;
  @Expose() name: string;
  @Expose() key: string;
  @Expose() color: string;
  @Expose() orderIndex: number;
  @Expose() wipLimit: number | null;
  @Expose() category: string;
  @Expose() isDefault: boolean;
  @Expose() isTerminal: boolean;
  @Expose() isActive: boolean;
  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}

// ── Priority ──────────────────────────────────────────────────────────────────

export class ProjectPrioritySerializer extends BaseSerializer {
  @Expose() projectId: string;
  @Expose() name: string;
  @Expose() key: string;
  @Expose() color: string;
  @Expose() orderIndex: number;
  @Expose() isDefault: boolean;
  @Expose() isActive: boolean;
  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}

// ── Severity ──────────────────────────────────────────────────────────────────

export class ProjectSeveritySerializer extends BaseSerializer {
  @Expose() projectId: string;
  @Expose() name: string;
  @Expose() key: string;
  @Expose() color: string;
  @Expose() orderIndex: number;
  @Expose() isDefault: boolean;
  @Expose() isActive: boolean;
  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}

// ── Task Type ─────────────────────────────────────────────────────────────────

export class ProjectTaskTypeSerializer extends BaseSerializer {
  @Expose() projectId: string;
  @Expose() name: string;
  @Expose() key: string;
  @Expose() icon: string | null;
  @Expose() color: string;
  @Expose() isDefault: boolean;
  @Expose() isSubtaskType: boolean;
  @Expose() isActive: boolean;
  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}

// ── Label ─────────────────────────────────────────────────────────────────────

export class ProjectLabelSerializer extends BaseSerializer {
  @Expose() projectId: string;
  @Expose() name: string;
  @Expose() key: string;
  @Expose() color: string;
  @Expose() isActive: boolean;
  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}
