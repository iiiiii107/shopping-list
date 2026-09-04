import { describe, it, expect } from 'vitest';
import {
  newList, newItem, newSection, orderBetween, orderAtEnd,
  readingOrder, itemsInSection, itemToText, retextItem, progressOf,
} from './list.js';

describe('the factories keep what they are given', () => {
  /* This is the cook book's worst bug, written down as a test.

     Its newRecipe() took { bookId, title } and quietly dropped the rest, so
     every import — markdown, link, screenshot, pasted text — saved a record
     with the right name and nothing in it. The parser was fine. The factory
     threw the contents away one line later, and it was reported twice before
     anyone found it. */
  it('newList does not drop fields it was not expecting', () => {
    const list = newList({
      title: 'Weekly shop',
      subtitle: 'for the flat',
      store: 'Billa',
      paper: 'ruled',
      items: [newItem({ text: '250 ml milk' })],
      sections: [newSection({ label: 'Fruit' })],
    });

    expect(list.subtitle).toBe('for the flat');
    expect(list.store).toBe('Billa');
    expect(list.paper).toBe('ruled');
    expect(list.items).toHaveLength(1);
    expect(list.sections).toHaveLength(1);
  });

  it('newItem does not drop fields it was not expecting', () => {
    const item = newItem({ text: 'olives', sectionId: 'abc', order: 42, done: true });
    expect(item.sectionId).toBe('abc');
    expect(item.order).toBe(42);
    expect(item.done).toBe(true);
  });

  it('mints a fresh id, so a list shared to you cannot collide with theirs', () => {
    const a = newList({ title: 'Shop' });
    const b = newList({ ...a });
    expect(b.id).not.toBe(a.id);
  });

  it('reads the quantity out of a typed line', () => {
    const item = newItem({ text: '250 ml milk' });
    expect(item.qty).toBe(250);
    expect(item.unit).toBe('ml');
    expect(item.text).toBe('milk');
  });

  it('keeps a line with no quantity exactly as written', () => {
    const item = newItem({ text: 'something for pudding' });
    expect(item.qty).toBeNull();
    expect(item.text).toBe('something for pudding');
  });
});

describe('fractional ordering', () => {
  it('puts a new item between its neighbours', () => {
    const order = orderBetween({ order: 2000 }, { order: 3000 });
    expect(order).toBeGreaterThan(2000);
    expect(order).toBeLessThan(3000);
  });

  it('handles both ends of the list', () => {
    expect(orderBetween(null, { order: 1000 })).toBeLessThan(1000);
    expect(orderBetween({ order: 1000 }, null)).toBeGreaterThan(1000);
    expect(orderBetween(null, null)).toBeGreaterThan(0);
  });

  /* The reason for floats in the first place: two people inserting into the
     same gap must not have to renumber anything, because they would be
     renumbering each other. */
  it('survives two people inserting into the same gap at once', () => {
    const before = { order: 1000 };
    const after = { order: 2000 };

    const hers = { id: 'aaa', order: orderBetween(before, after) };
    const his = { id: 'bbb', order: orderBetween(before, after) };

    // They collide, which is fine — neither is lost, and the id breaks the tie
    // identically on both devices, so nobody sees a different order.
    const sorted = [after, his, before, hers].sort((a, b) =>
      (a.order - b.order) || String(a.id).localeCompare(String(b.id)));

    expect(sorted).toHaveLength(4);
    expect(sorted[0]).toBe(before);
    expect(sorted[3]).toBe(after);
    expect(sorted.slice(1, 3).map((i) => i.id)).toEqual(['aaa', 'bbb']);
  });

  it('deepening insertions never reorder what is already there', () => {
    let lo = { order: 0 };
    const hi = { order: 1000 };
    const inserted = [];

    for (let i = 0; i < 30; i += 1) {
      const next = { id: `i${i}`, order: orderBetween(lo, hi) };
      inserted.push(next);
      lo = next;
    }

    const orders = inserted.map((i) => i.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(orders.every((o) => o > 0 && o < 1000)).toBe(true);
  });

  it('appends past everything already on the list', () => {
    const items = [{ order: 1000 }, { order: 5500 }, { order: 2000 }];
    expect(orderAtEnd(items)).toBeGreaterThan(5500);
    expect(orderAtEnd([])).toBeGreaterThan(0);
  });
});

describe('reading the sheet', () => {
  function sheet() {
    const fruit = newSection({ label: 'Fruit', order: 1000 });
    return newList({
      title: 'Shop',
      sections: [fruit],
      items: [
        newItem({ text: 'bread', order: 2000 }),
        newItem({ text: 'milk', order: 1000 }),
        newItem({ text: '3 apples', sectionId: fruit.id, order: 1000 }),
      ],
    });
  }

  it('puts loose items first, then each section, each in order', () => {
    const groups = readingOrder(sheet());
    expect(groups[0].section).toBeNull();
    expect(groups[0].items.map((i) => i.text)).toEqual(['milk', 'bread']);
    expect(groups[1].section.label).toBe('Fruit');
    expect(groups[1].items.map((i) => i.text)).toEqual(['apples']);
  });

  /* An item vanishing off a shopping list is worse than one in the wrong
     place — you find out at the till. */
  it('an item pointing at a section that is gone reappears at the top', () => {
    const list = sheet();
    list.sections = [];
    const loose = readingOrder(list)[0].items.map((i) => i.text);
    expect(loose).toContain('apples');
  });

  it('counts what is left to find', () => {
    const list = sheet();
    list.items[0].done = true;
    expect(progressOf(list)).toEqual({ done: 1, total: 3 });
  });

  it('itemsInSection ignores the ones in other sections', () => {
    const list = sheet();
    expect(itemsInSection(list, '')).toHaveLength(2);
  });
});

describe('a line survives being written, read and rewritten', () => {
  it('round-trips through text', () => {
    for (const line of ['250 ml milk', '3 apples', 'a bunch of parsley', '1.5 kg potatoes']) {
      expect(itemToText(newItem({ text: line }))).toBe(line);
    }
  });

  it('picks up a quantity typed over a bare name', () => {
    const item = newItem({ text: 'tomatoes' });
    expect(item.qty).toBeNull();

    const next = retextItem(item, '2 cans tomatoes');
    expect(next.qty).toBe(2);
    expect(next.unit).toBe('can');
    expect(next.text).toBe('tomatoes');
    expect(next.id).toBe(item.id);
  });

  /* Typing a quantity away has to clear it, not leave the old one behind —
     otherwise "500 g flour" edited down to "flour" still adds 500 g to
     whatever it is merged with, silently. */
  it('clears a quantity that has been typed away', () => {
    const item = newItem({ text: '500 g flour' });
    const next = retextItem(item, 'flour');
    expect(next.qty).toBeNull();
    expect(next.unit).toBe('');
  });
});
