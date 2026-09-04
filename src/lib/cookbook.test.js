/* @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { listFromWeek, weeks, spanOf } from './cookbook.js';
import { readingOrder, itemToText } from './list.js';
import { parseItem } from './item.js';
import { todayISO } from './dates.js';
import { store } from './store.js';

/* A cook book, in the shape the cook book actually saves: a plan keyed by
   date, recipes as their own records, and standbys for the meals that never
   had a recipe. */
function cookbook() {
  const risotto = {
    id: 'r1', title: 'Risotto', servings: 4,
    ingredients: ['100 ml milk', '300 g rice', '1 onion'].map(parseItem),
  };
  const gratin = {
    id: 'r2', title: 'Gratin', servings: 4,
    ingredients: ['150 ml milk', '500 g potatoes', '2 onions'].map(parseItem),
  };

  const today = todayISO();
  return {
    recipes: [risotto, gratin],
    standbys: [{ id: 's1', name: 'jam sandwich', ingredients: [] }],
    plan: {
      [today]: {
        breakfast: [{ id: 'e1', standbyId: 's1' }],
        lunch: [],
        dinner: [{ id: 'e2', recipeId: 'r1' }, { id: 'e3', recipeId: 'r2' }],
      },
    },
  };
}

const thisWeek = () => weeks().find((w) => w.label === 'This week').dates;

describe('a planned week, as a list to shop from', () => {
  /* The whole reason this reads the cook book's data rather than its exported
     file: the quantities are still numbers here, so they add up. */
  it('adds the same thing from two recipes into one line', () => {
    const list = listFromWeek(cookbook(), { dates: thisWeek() });
    const lines = list.items.map(itemToText);
    expect(lines).toContain('250 ml milk');
    expect(lines).not.toContain('100 ml milk');
    expect(lines).not.toContain('150 ml milk');
  });

  it('counts the same thing from two recipes', () => {
    const list = listFromWeek(cookbook(), { dates: thisWeek() });
    expect(list.items.map(itemToText)).toContain('3 onions');
  });

  it('the aisles become the headings, because that is what they were for', () => {
    const list = listFromWeek(cookbook(), { dates: thisWeek() });
    expect(list.sections.length).toBeGreaterThan(1);
    for (const { section, items } of readingOrder(list)) {
      if (section) expect(items.length).toBeGreaterThan(0);
    }
  });

  /* A jam sandwich has nothing to buy attached to it, but it is still on
     Tuesday — so it comes out at the foot rather than disappearing, as a
     reminder to check you have the bread. */
  it('keeps the meals that brought nothing to buy', () => {
    const list = listFromWeek(cookbook(), { dates: thisWeek() });
    const also = readingOrder(list).find((g) => g.section?.label === 'Also on the week');
    expect(also).toBeTruthy();
    expect(also.items.map((i) => i.text)).toContain('jam sandwich');
  });

  it('an empty week makes no list at all, rather than an empty one', () => {
    const empty = { plan: {}, recipes: [], standbys: [] };
    expect(listFromWeek(empty, { dates: thisWeek() })).toBeNull();
  });

  it('subtitles itself with the week it covers', () => {
    const list = listFromWeek(cookbook(), { dates: thisWeek() });
    expect(list.subtitle).toBe(spanOf(thisWeek()));
    expect(list.subtitle).toMatch(/–/);
  });

  it('offers last week, this week and next', () => {
    expect(weeks().map((w) => w.label)).toEqual(['Last week', 'This week', 'Next week']);
  });
});

describe('what lands in the store', () => {
  /* Same rule as everywhere else in this app: the assertion is on what was
     saved, not on what the builder handed back. */
  it('arrives whole, headings and quantities and all', async () => {
    await store.init();
    store.state.lists = [];

    const built = listFromWeek(cookbook(), { dates: thisWeek(), title: "This week's shop" });
    const saved = store.addList(built);

    const fromStore = store.listById(saved.id);
    expect(fromStore.title).toBe("This week's shop");
    expect(fromStore.subtitle).toBeTruthy();
    expect(fromStore.sections.length).toBe(built.sections.length);
    expect(fromStore.items.map(itemToText)).toContain('250 ml milk');
    expect(fromStore.items.find((i) => i.text === 'milk').qty).toBe(250);
  });
});
