import { BadRequestException } from '@nestjs/common';
import { normalizePadName } from './pad-name';

describe('normalizePadName', () => {
  it('lowercases and keeps segments', () => {
    expect(normalizePadName('Faculdade/Calculo')).toBe('faculdade/calculo');
  });

  it.each(['', 'a//b', '../x', 'a b', 'x'.repeat(201)])('rejects %j', (raw) => {
    expect(() => normalizePadName(raw)).toThrow(BadRequestException);
  });
});
