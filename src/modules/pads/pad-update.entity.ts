import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class PadUpdate {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'varchar' })
  padName!: string;

  @Column({ type: 'integer' })
  seq!: number;

  @Column({ type: 'blob' })
  data!: Buffer;
}
