import { Expose } from 'class-transformer';

/** Public active-attempt fields, including its workflow command identifier. */
export class ChecklistSubmissionSerializer {
  @Expose() id: string;
  @Expose() attemptNumber: number;
  @Expose() outcome: string;
  @Expose() submittedByUserId: string;
  @Expose() submittedAt: Date;
  @Expose() submissionNote: string | null;
  @Expose() outcomeByUserId: string | null;
  @Expose() outcomeAt: Date | null;
  @Expose() source: string;
}
