import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Protected <=> verifier !== null. A protected pad never stores readable state. */
@Entity()
export class Pad {
  @PrimaryColumn({ type: 'varchar' })
  name!: string;

  @Column({ type: 'blob', nullable: true })
  state!: Buffer | null;

  @Column({ type: 'blob', nullable: true })
  salt!: Buffer | null;

  /** SHA-256(authKey). */
  @Column({ type: 'blob', nullable: true })
  verifier!: Buffer | null;

  /** Bumped on every password change; invalidates older tokens. */
  @Column({ type: 'integer', default: 0 })
  keyVersion!: number;

  @Column({ type: 'blob', nullable: true })
  snapshot!: Buffer | null;

  @Column({ type: 'integer', default: 1 })
  nextSeq!: number;

  @UpdateDateColumn()
  updatedAt!: Date;
}
