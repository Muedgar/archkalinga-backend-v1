import {
  CanonicalStage as S,
  ProjectStatus,
} from '../project-config/project-status.entity';
import { TaskChecklistItem } from '../entities';
import { activeStage, reduceStages } from './workflow-domain';
import { authorizeTransition } from './checklist-policy';
const status = (stage: S | null): ProjectStatus =>
  ({
    id: stage ?? 'custom',
    canonicalStage: stage,
    isActive: true,
  }) as ProjectStatus;
const item = { completed: false, branchedTaskId: null } as TaskChecklistItem;
describe('canonical workflow contract', () => {
  it.each([
    [[], S.TODO],
    [[S.TODO, S.IN_PROGRESS], S.TODO],
    [[S.IN_PROGRESS, S.IN_REVIEW], S.IN_PROGRESS],
    [[S.IN_REVIEW, S.DONE], S.IN_REVIEW],
    [[S.DONE, S.DONE], S.DONE],
    [[S.IN_REVIEW, S.IN_REVIEW], S.IN_REVIEW],
  ])('reduces %j to %s', (input, expected) =>
    expect(reduceStages(input as S[])).toBe(expected),
  );
  it('withdrawal to custom resets Review to Progress', () =>
    expect(activeStage(S.IN_REVIEW, null)).toBe(S.IN_PROGRESS));
  it('custom work never advances an untouched item', () =>
    expect(activeStage(S.TODO, null)).toBe(S.TODO));
  it.each(['MOVE', 'SUBMIT', 'ACCEPT', 'REJECT', 'WITHDRAW'] as const)(
    'Done rejects %s',
    (intent) => {
      expect(() =>
        authorizeTransition(
          { ...item, completed: true } as TaskChecklistItem,
          status(S.DONE),
          status(S.TODO),
          { assignee: true, reviewer: true },
          intent,
        ),
      ).toThrow('CHECKLIST_DONE_IS_TERMINAL');
    },
  );
  it('roles do not bypass review', () =>
    expect(() =>
      authorizeTransition(item, status(S.TODO), status(S.DONE), {
        assignee: true,
        reviewer: true,
      }),
    ).toThrow('CHECKLIST_REVIEW_REQUIRED'));
  it('reportee cannot move active work', () =>
    expect(() =>
      authorizeTransition(item, status(S.TODO), status(S.IN_PROGRESS), {
        assignee: false,
        reviewer: true,
      }),
    ).toThrow());
  it('assignee cannot accept', () =>
    expect(() =>
      authorizeTransition(item, status(S.IN_REVIEW), status(S.DONE), {
        assignee: true,
        reviewer: false,
      }),
    ).toThrow());
  it('dual role self-approves', () =>
    expect(
      authorizeTransition(item, status(S.IN_REVIEW), status(S.DONE), {
        assignee: true,
        reviewer: true,
      }),
    ).toBe('ACCEPT'));
  it('dual-role return requires explicit intent', () =>
    expect(() =>
      authorizeTransition(item, status(S.IN_REVIEW), status(S.TODO), {
        assignee: true,
        reviewer: true,
      }),
    ).toThrow('CHECKLIST_RETURN_INTENT_REQUIRED'));
  it('same-status review movement is only ordering', () =>
    expect(
      authorizeTransition(item, status(S.IN_REVIEW), status(S.IN_REVIEW), {
        assignee: true,
        reviewer: false,
      }),
    ).toBe('MOVE'));
  it('a branched source is never executable', () =>
    expect(() =>
      authorizeTransition(
        { ...item, branchedTaskId: 'child' } as TaskChecklistItem,
        status(S.TODO),
        status(S.IN_PROGRESS),
        { assignee: true, reviewer: true },
      ),
    ).toThrow('BRANCHED_CHECKLIST_STATUS_IS_DERIVED'));
});
