import { describe, it, expect } from 'vitest';
import {
  compatible, toBase, fromBase, normaliseItem, mergeIngredients, formatAmount,
} from './units.js';
import { parseIngredient } from './item.js';

/** Shorthand: parse a line the way the editor would, then tag its recipe. */
const ing = (line, recipe = 'r') => ({ ...parseIngredient(line), recipe });
const merged = (...lines) => mergeIngredients(lines.map((l) => ing(l)));
const listOf = (...lines) => merged(...lines).map((e) => `${formatAmount(e)} ${e.item}`.trim());

describe('compatible', () => {
  it('adds within a family', () => {
    expect(compatible('ml', 'l')).toBe(true);
    expect(compatible('g', 'kg')).toBe(true);
    expect(compatible('tsp', 'tbsp')).toBe(true);
  });

  it('refuses across families, because the conversion depends on the ingredient', () => {
    expect(compatible('tbsp', 'ml')).toBe(false);
    expect(compatible('g', 'ml')).toBe(false);
    expect(compatible('cup', 'ml')).toBe(false);
  });

  it('treats two unitless counts as compatible', () => {
    expect(compatible('', '')).toBe(true);
  });
});

describe('toBase / fromBase', () => {
  it('converts into the family base', () => {
    expect(toBase(1, 'kg')).toBe(1000);
    expect(toBase(2, 'l')).toBe(2000);
    expect(toBase(1, 'tbsp')).toBe(3);
  });

  it('steps up only when the bigger unit reads well', () => {
    expect(fromBase(700, 'mass')).toEqual({ qty: 700, unit: 'g' });
    expect(fromBase(1500, 'mass')).toEqual({ qty: 1.5, unit: 'kg' });
    expect(fromBase(250, 'volume')).toEqual({ qty: 250, unit: 'ml' });
    expect(fromBase(100, 'volume')).toEqual({ qty: 100, unit: 'ml' });   // not 1 dl
    expect(fromBase(1333, 'mass')).toEqual({ qty: 1333, unit: 'g' });    // 1.33 kg would lose 3 g
    expect(fromBase(2000, 'volume')).toEqual({ qty: 2, unit: 'l' });
  });
});

describe('normaliseItem', () => {
  it('matches singular and plural', () => {
    expect(normaliseItem('eggs')).toBe(normaliseItem('egg'));
    expect(normaliseItem('Tomatoes')).toBe(normaliseItem('tomato'));
    expect(normaliseItem('cherries')).toBe(normaliseItem('cherry'));
  });

  it('leaves words that merely end in s alone', () => {
    expect(normaliseItem('asparagus')).toBe('asparagus');
    expect(normaliseItem('couscous')).toBe('couscous');
    expect(normaliseItem('watercress')).toBe('watercress');
  });

  it('drops leading articles and trailing punctuation', () => {
    expect(normaliseItem('a lemon')).toBe('lemon');
    expect(normaliseItem('  Olive Oil.  ')).toBe('olive oil');
  });
});

describe('mergeIngredients', () => {
  it('adds the same unit — the case this whole file exists for', () => {
    expect(listOf('100 ml milk', '150 ml milk')).toEqual(['250 ml milk']);
  });

  it('adds across a family, converting as it goes', () => {
    expect(listOf('200 g flour', '0.5 kg flour')).toEqual(['700 g flour']);
    expect(listOf('1 tbsp oil', '1 tsp oil')).toEqual(['4 tsp oil']);
  });

  it('keeps unmergeable amounts side by side rather than inventing a total', () => {
    expect(listOf('2 tbsp olive oil', '100 ml olive oil')).toEqual(['2 tbsp + 100 ml olive oil']);
  });

  it('merges plurals onto one line', () => {
    expect(listOf('3 eggs', '2 egg')).toEqual(['5 egg']);
  });

  it('keeps an unquantified line on the list with no amount', () => {
    expect(listOf('salt to taste')).toEqual(['salt to taste']);
  });

  it('does not double an unquantified line that appears twice', () => {
    const entries = merged('salt to taste', 'salt to taste');
    expect(entries).toHaveLength(1);
    expect(entries[0].amounts).toHaveLength(1);
  });

  it('adds a quantity to an item that also appears unquantified', () => {
    expect(listOf('salt', '5 g salt')).toEqual(['5 g salt']);
  });

  it('keeps different items apart', () => {
    expect(listOf('100 ml milk', '100 ml cream')).toEqual(['100 ml milk', '100 ml cream']);
  });

  it('records which recipes an item came from', () => {
    const entries = mergeIngredients([ing('100 ml milk', 'Carbonara'), ing('150 ml milk', 'Custard')]);
    expect(entries[0].from).toEqual(['Carbonara', 'Custard']);
  });

  it('adds up the countables, so a shopping list is not split in two', () => {
    expect(listOf('3 sheets of gelatine', '2 sheets of gelatine')).toEqual(['5 sheets gelatine']);
  });

  it('counts unitless quantities', () => {
    expect(listOf('2 onions', '1 onion')).toEqual(['3 onion']);
  });

  it('ignores empty input without falling over', () => {
    expect(mergeIngredients([])).toEqual([]);
    expect(mergeIngredients([null, { item: '' }])).toEqual([]);
  });
});
