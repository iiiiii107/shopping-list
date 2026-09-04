import { describe, it, expect } from 'vitest';
import { aisleOf, groupByAisle, AISLES } from './aisles.js';
import { normaliseItem } from './units.js';

describe('aisleOf', () => {
  it('places the everyday things', () => {
    expect(aisleOf('spaghetti')).toBe('dry');
    expect(aisleOf('pecorino romano')).toBe('dairy');
    expect(aisleOf('guanciale')).toBe('meat');
    expect(aisleOf('lemon')).toBe('produce');
    expect(aisleOf('ciabatta')).toBe('bakery');
  });

  it('checks the more specific keyword first', () => {
    // "coconut milk" is a tin, not dairy, and must be seen before "milk".
    expect(aisleOf('coconut milk')).toBe('tins');
    expect(aisleOf('milk')).toBe('dairy');
    expect(aisleOf('tomato')).toBe('produce');
  });

  it('matches the singular forms that normaliseItem produces', () => {
    // The list is built from normalised names, so "chopped tomatoes" arrives
    // here as "chopped tomato". A plural keyword would silently never match
    // and the tin would end up in the vegetable aisle.
    expect(aisleOf(normaliseItem('chopped tomatoes'))).toBe('tins');
    expect(aisleOf(normaliseItem('plum tomatoes'))).toBe('tins');
    expect(aisleOf(normaliseItem('olives'))).toBe('tins');
    expect(aisleOf(normaliseItem('eggs'))).toBe('dairy');
    expect(aisleOf(normaliseItem('carrots'))).toBe('produce');
  });

  it('respects word boundaries so short keywords do not overreach', () => {
    expect(aisleOf('peanut butter')).toBe('tins');   // not produce via "pea"
    expect(aisleOf('pea')).toBe('produce');
  });

  it('sends anything unrecognised to Other rather than guessing', () => {
    expect(aisleOf('bicarbonate of soda')).toBe('dry');
    expect(aisleOf('a thing nobody has heard of')).toBe('other');
    expect(aisleOf('')).toBe('other');
  });
});

describe('groupByAisle', () => {
  const entries = ['spaghetti', 'egg', 'guanciale', 'pecorino', 'lemon']
    .map((item) => ({ item }));

  it('keeps only the aisles that have something in them', () => {
    const groups = groupByAisle(entries);
    expect(groups.map((g) => g.id)).toEqual(['produce', 'dairy', 'meat', 'dry']);
  });

  it('presents aisles in shop order, not the order things were added', () => {
    const groups = groupByAisle(entries);
    const order = AISLES.map((a) => a.id);
    const positions = groups.map((g) => order.indexOf(g.id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('loses nothing', () => {
    const groups = groupByAisle(entries);
    expect(groups.flatMap((g) => g.items)).toHaveLength(entries.length);
  });
});
