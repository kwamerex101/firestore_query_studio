import { describe, expect, it } from 'vitest';
import {
  firestoreRowsToCsv,
  formatCellText,
  sqlRowsToCsv,
} from '../../src/shared/csv';

describe('formatCellText', () => {
  it('stringifies primitives', () => {
    expect(formatCellText('hello')).toBe('hello');
    expect(formatCellText(42)).toBe('42');
    expect(formatCellText(true)).toBe('true');
    expect(formatCellText(null)).toBe('');
    expect(formatCellText(undefined)).toBe('');
  });

  it('JSON-stringifies objects and arrays', () => {
    expect(formatCellText({ a: 1 })).toBe('{"a":1}');
    expect(formatCellText([1, 2, 3])).toBe('[1,2,3]');
  });
});

describe('firestoreRowsToCsv', () => {
  it('emits id, path, and discovered columns in order', () => {
    const csv = firestoreRowsToCsv(
      [
        { id: 'a', path: 'c/a', data: { name: 'Ada', age: 30 } },
        { id: 'b', path: 'c/b', data: { name: 'Bob', age: 42 } },
      ],
      ['name', 'age'],
    );
    const lines = csv.split('\n');
    expect(lines[0]).toBe('__id,__path,name,age');
    expect(lines[1]).toBe('a,c/a,Ada,30');
    expect(lines[2]).toBe('b,c/b,Bob,42');
  });

  it('quotes fields containing commas, quotes, and newlines', () => {
    const csv = firestoreRowsToCsv(
      [
        {
          id: '1',
          path: 'p/1',
          data: { note: 'hello, "world"\nnew line' },
        },
      ],
      ['note'],
    );
    expect(csv).toBe(
      '__id,__path,note\n1,p/1,"hello, ""world""\nnew line"',
    );
  });

  it('emits empty strings for missing fields', () => {
    const csv = firestoreRowsToCsv(
      [{ id: '1', path: 'p/1', data: { a: 1 } }],
      ['a', 'b'],
    );
    expect(csv.split('\n')[1]).toBe('1,p/1,1,');
  });
});

describe('sqlRowsToCsv', () => {
  it('uses the driver-provided column order', () => {
    const csv = sqlRowsToCsv(
      [
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Bob' },
      ],
      [{ name: 'id' }, { name: 'name' }],
    );
    expect(csv).toBe('id,name\n1,Ada\n2,Bob');
  });

  it('handles nested values by JSON-encoding them', () => {
    const csv = sqlRowsToCsv(
      [{ id: 1, tags: ['a', 'b'] }],
      [{ name: 'id' }, { name: 'tags' }],
    );
    expect(csv.split('\n')[1]).toBe('1,"[""a"",""b""]"');
  });
});
