import { randomUUID } from 'crypto';
import { parseTaskPackage } from './create-task-package.dto';

const task = () => ({
  title: 'Foundation works',
  statusId: randomUUID(),
  scheduleType: 'task',
  assignedMembers: [],
  reportee: null,
});
const checklist = (clientId: string) => ({
  ...task(),
  clientId,
  plannedStartDate: null,
  durationDays: 1,
  starterDocuments: [],
  deliverableDocuments: [],
});
const parse = (body: unknown) => parseTaskPackage(JSON.stringify(body));

describe('Task package contract', () => {
  it('accepts UNBRANCHED and validates branch source identifiers and required new checklists', async () => {
    await expect(
      parse({ task: task(), checklistMode: 'UNBRANCHED' }),
    ).resolves.toBeDefined();
    await expect(
      parse({ task: task(), checklistMode: 'BRANCHED' }),
    ).rejects.toThrow();
    await expect(
      parse({
        task: task(),
        branchFrom: { taskId: randomUUID(), checklistItemId: randomUUID() },
      }),
    ).rejects.toThrow('at least one');
    await expect(
      parse({
        task: task(),
        branchFrom: { taskId: 'bad', checklistItemId: 'bad' },
        checklists: [checklist('a')],
      }),
    ).rejects.toThrow();
  });
  it('accepts a task without children or assignments and ignores a different reportee', async () => {
    const dto = await parse({
      task: { ...task(), reportee: { userId: randomUUID() } },
    });
    expect(dto.task.assignedMembers).toEqual([]);
    expect(dto.checklists).toEqual([]);
  });
  it.each(['null', '[]', 'bad json', '"hello"'])(
    'rejects malformed payload %s',
    async (payload) => {
      await expect(parseTaskPackage(payload)).rejects.toThrow();
    },
  );
  it.each([0, -1, 1.5, null])(
    'rejects invalid duration %s',
    async (durationDays) => {
      await expect(
        parse({
          task: task(),
          checklists: [{ ...checklist('a'), durationDays }],
        }),
      ).rejects.toThrow();
    },
  );
  it('rejects nonexistent calendar dates', async () => {
    await expect(
      parse({
        task: task(),
        checklists: [{ ...checklist('a'), plannedStartDate: '2026-02-30' }],
      }),
    ).rejects.toThrow();
  });
  it('rejects duplicate client IDs', async () => {
    await expect(
      parse({ task: task(), checklists: [checklist('a'), checklist('a')] }),
    ).rejects.toThrow('Duplicate');
  });
  it.each([
    [['a', 'a']],
    [['a', 'missing']],
    [
      ['a', 'b'],
      ['b', 'a'],
    ],
    [
      ['a', 'b'],
      ['a', 'b'],
    ],
  ])('rejects invalid graph %j', async (...args) => {
    const edges = args as unknown as string[][];
    await expect(
      parse({
        task: task(),
        checklists: [checklist('a'), checklist('b')],
        dependencies: edges.map(([to, from]) => ({
          checklistClientId: to,
          dependsOnChecklistClientId: from,
          dependencyType: 'FS',
          lagDays: 0,
        })),
      }),
    ).rejects.toThrow();
  });
  it('requires the attachment UUID, not just a document UUID', async () => {
    const doc = {
      name: 'Drawing',
      type: 'STARTER',
      mode: 'FROM_DELIVERABLE',
      sourceTaskId: randomUUID(),
      sourceDocumentId: randomUUID(),
    };
    await expect(
      parse({ task: task(), generalStarterDocuments: [doc] }),
    ).rejects.toThrow('sourceAttachmentId');
    await expect(
      parse({
        task: task(),
        generalStarterDocuments: [{ ...doc, sourceAttachmentId: randomUUID() }],
      }),
    ).resolves.toBeDefined();
  });
  it('accepts file-free expected deliverables but rejects attached files on definitions', async () => {
    const doc = {
      name: 'Inspection report',
      description: 'Expected evidence',
      type: 'DELIVERABLE',
      mode: 'DEFINE',
    };
    await expect(
      parse({
        task: task(),
        checklists: [{ ...checklist('a'), deliverableDocuments: [doc] }],
      }),
    ).resolves.toBeDefined();
    await expect(
      parse({
        task: task(),
        checklists: [
          {
            ...checklist('a'),
            deliverableDocuments: [{ ...doc, fileKey: 'file_0' }],
          },
        ],
      }),
    ).rejects.toThrow();
  });
  it('rejects parent deliverables and overlong rich text', async () => {
    await expect(
      parse({
        task: task(),
        generalStarterDocuments: [
          { name: 'Output', type: 'DELIVERABLE', mode: 'DEFINE' },
        ],
      }),
    ).rejects.toThrow();
    await expect(
      parse({
        task: {
          ...task(),
          description: {
            type: 'doc',
            content: [{ type: 'text', text: 'x'.repeat(4001) }],
          },
        },
      }),
    ).rejects.toThrow('4000');
  });
});
