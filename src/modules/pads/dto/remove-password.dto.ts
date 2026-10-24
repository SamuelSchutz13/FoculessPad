import { IsString, Matches } from 'class-validator';
import { BASE64URL } from './unlock.dto';

export class RemovePasswordDto {
  @IsString()
  @Matches(BASE64URL)
  state!: string;
}
