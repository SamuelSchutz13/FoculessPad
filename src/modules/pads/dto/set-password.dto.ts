import { IsString, Matches } from 'class-validator';
import { BASE64URL } from './unlock.dto';

export class SetPasswordDto {
  @IsString()
  @Matches(BASE64URL)
  salt!: string;

  @IsString()
  @Matches(BASE64URL)
  authKey!: string;

  @IsString()
  @Matches(BASE64URL)
  snapshot!: string;
}
