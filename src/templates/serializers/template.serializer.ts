import { Expose, Transform, Type } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

type TaskNode = {
  id: string;
  name: string;
  description: string;
  order: number;
  createdAt?: Date;
  updatedAt?: Date;
  parentTaskId?: string | null;
  subtasks: TaskNode[];
};

function buildTemplateTaskTree(
  rawTasks: Array<{
    id: string;
    name: string;
    description: string;
    order: number;
    createdAt?: Date;
    updatedAt?: Date;
    parentTaskId?: string | null;
  }>,
): TaskNode[] {
  const taskMap = new Map<string, TaskNode>();

  rawTasks.forEach((task) => {
    taskMap.set(task.id, {
      id: task.id,
      name: task.name,
      description: task.description,
      order: task.order,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      parentTaskId: task.parentTaskId ?? null,
      subtasks: [],
    });
  });

  const roots: TaskNode[] = [];
  for (const task of taskMap.values()) {
    if (task.parentTaskId) {
      const parent = taskMap.get(task.parentTaskId);
      if (parent) {
        parent.subtasks.push(task);
        continue;
      }
    }
    roots.push(task);
  }

  const sortTree = (nodes: TaskNode[]): TaskNode[] =>
    nodes
      .sort((a, b) => a.order - b.order)
      .map((node) => ({
        ...node,
        subtasks: sortTree(node.subtasks),
      }));

  return sortTree(roots);
}

class TemplateTaskSerializer extends BaseSerializer {
  @Expose() name: string;
  @Expose() description: string;
  @Expose() order: number;
  @Expose()
  @Type(() => TemplateTaskSerializer)
  subtasks: TemplateTaskSerializer[];
  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}

export class TemplateSerializer extends BaseSerializer {
  @Expose() workspaceId: string;
  @Expose() name: string;
  @Expose() description: string;
  @Expose() isDefault: boolean;

  @Expose()
  @Transform(({ obj }) => buildTemplateTaskTree(obj?.tasks ?? []))
  @Type(() => TemplateTaskSerializer)
  tasks: TemplateTaskSerializer[];

  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}
