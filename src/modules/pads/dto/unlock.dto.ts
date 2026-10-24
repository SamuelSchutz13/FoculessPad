import { IsString, Matches } from 'class-validator';

export const BASE64URL = /^[A-Za-z0-9_-]+$/;

export class UnlockDto {
  @IsString()
  @Matches(BASE64URL)
  authKey!: string;
}
