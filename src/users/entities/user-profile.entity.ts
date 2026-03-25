import { AppBaseEntity } from 'src/common/entities';
import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { User } from './user.entity';

@Entity('user_profiles')
export class UserProfile extends AppBaseEntity {
  @OneToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  profession: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  specialty: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  /** For INDIVIDUAL users who also run a firm / studio. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  organizationName: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  organizationWebsite: string | null;

  @Column({ type: 'integer', nullable: true })
  teamSize: number | null;
}
