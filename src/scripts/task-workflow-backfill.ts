/** Explicit operator command: defaults to rollback-only preview. Never runs at application startup. */
import { dataSource } from '../config/db/db.config';
import {
  lockWorkflow,
  rollupStatuses,
} from '../tasks/workflow/workflow-domain';
import { auditWorkflow } from '../tasks/workflow/workflow-audit';
import {
  Task,
  TaskChecklistItem,
  TaskWorkflowActivation,
} from '../tasks/entities';
const projectId = process.argv
  .find((a) => a.startsWith('--project-id='))
  ?.slice('--project-id='.length);
const apply = process.argv.includes('--apply');
async function main() {
  if (!projectId || !/^[0-9a-f-]{36}$/i.test(projectId))
    throw new Error(
      'Usage: npm run workflow:backfill -- --project-id=<uuid> [--apply]',
    );
  await dataSource.initialize();
  const tx = dataSource.createQueryRunner();
  await tx.connect();
  await tx.startTransaction();
  try {
    await lockWorkflow(tx.manager, projectId);
    const report = await auditWorkflow(tx.manager, projectId);
    if (report.issues.length) {
      console.log(JSON.stringify(report, null, 2));
      throw new Error('Activation blocked: resolve reported records first');
    }
    await tx.query("SELECT set_config('app.workflow_backfill','on',true)");
    const beforeTasks = await tx.manager.find(Task, {
      where: { projectId },
      select: ['id', 'statusId', 'completed', 'version'],
    });
    const beforeItems = await tx.manager
      .createQueryBuilder(TaskChecklistItem, 'i')
      .innerJoin(Task, 't', 't.id=i.taskId')
      .where('t.projectId=:projectId', { projectId })
      .select(['i.id', 'i.statusId', 'i.completed', 'i.version'])
      .getMany();
    const changes = await rollupStatuses(tx.manager, projectId);
    const preview = {
      ...report,
      beforeTasks,
      beforeItems,
      mode: apply ? 'APPLY' : 'PREVIEW',
      changedTasks: changes.changedTasks.map((t) => ({
        id: t.id,
        statusId: t.statusId,
        completed: t.completed,
        revision: t.version,
      })),
      changedChecklistItems: changes.changedItems.map((i) => ({
        id: i.id,
        statusId: i.statusId,
      })),
    };
    console.log(JSON.stringify(preview, null, 2));
    if (apply) {
      await tx.query(
        `INSERT INTO workflow_migration_audit(project_id,operation,snapshot) VALUES ($1,'DERIVED_STATUS_ACTIVATION',$2::jsonb)`,
        [projectId, JSON.stringify(preview)],
      );
      await tx.manager.upsert(
        TaskWorkflowActivation,
        { projectId, activatedAt: new Date() },
        ['projectId'],
      );
      await tx.commitTransaction();
    } else await tx.rollbackTransaction();
  } catch (error) {
    if (tx.isTransactionActive) await tx.rollbackTransaction();
    throw error;
  } finally {
    await tx.release();
    await dataSource.destroy();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
