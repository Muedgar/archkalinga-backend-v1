/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Exclude, Expose } from 'class-transformer';

export class BaseSerializer {
  @Expose()
  id: string;
  @Exclude()
  createdAt: Date;

  @Exclude()
  updatedAt: Date;

  @Exclude()
  pkid;

  constructor(partial: Partial<BaseSerializer>) {
    Object.assign(this, partial);
  }
}
