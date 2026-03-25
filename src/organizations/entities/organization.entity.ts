import { AppBaseEntity } from 'src/common/entities';
import { Column, Entity, OneToMany } from 'typeorm';

@Entity('organizations')
export class Organization extends AppBaseEntity {
  @Column({ type: 'varchar', length: 200, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  country: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  website: string | null;
}
