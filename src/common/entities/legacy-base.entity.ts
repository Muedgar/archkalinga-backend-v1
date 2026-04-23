import {
  BaseEntity,
  Column,
  CreateDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

export abstract class LegacyUuidEntity extends BaseEntity {
  @PrimaryGeneratedColumn()
  pkid: number;

  @Column({ type: 'uuid', unique: true, default: () => 'uuid_generate_v4()' })
  id: string;
}

export abstract class LegacyUuidTimestampEntity extends LegacyUuidEntity {
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

export abstract class LegacyUuidCreatedAtEntity extends LegacyUuidEntity {
  @CreateDateColumn()
  createdAt: Date;
}

export abstract class SnakeCaseAppBaseEntity extends BaseEntity {
  @PrimaryGeneratedColumn()
  pkid: number;

  @Column({ type: 'uuid', unique: true, default: () => 'uuid_generate_v4()' })
  id: string;

  @VersionColumn({ default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
