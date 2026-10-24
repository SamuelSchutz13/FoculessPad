import { BadRequestException } from '@nestjs/common';

const VALID = /^[a-z0-9_-]+(\/[a-z0-9_-]+)*$/;

export function normalizePadName(raw: string): string {
  const name = raw.toLowerCase();
  if (name.length > 200 || !VALID.test(name)) {
    throw new BadRequestException('Invalid pad name');
  }
  return name;
}
