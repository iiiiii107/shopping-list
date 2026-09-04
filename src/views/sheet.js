import {
  el, add, svg, icon, iconButton, iconLink, modal, toast,
  checkSvg, strikeSvg, hashUnit, claimBodyFlag,
} from '../lib/dom.js';
import { store } from '../lib/store.js';
import { readingOrder, progressOf, itemToText, retextItem } from '../lib/list.js';
import { PAPER_STOCKS, PALETTE_KEYS, applySheetPalette, toHex } from '../lib/theme.js';

/* One list, as a single sheet of paper.

   Everything on it is edited where it sits — the title, the subtitle, the
   date, the shop, every item. The cook book spent a while with fields behind
   an Edit button and the verdict was blunt: "i don't like how i need to input
   the portion size and link with another button. let me do it all on the
   page." The same applies here, more so, because a shopping list is nothing
   but short fields.

   Editing in place has one hard rule: while something has focus, this view
   must not be rebuilt. A rebuild replaces the node the caret is in and the
   caret goes with it, mid-word. So a focused field claims the `editing` flag
   on <body>, which main.js's maybeGo() respects, and releases it on blur. */

export function renderSheet(scene, listId) {
  const list = store.listById(listId);
  if (!list) {
    add(scene, el('div', { class: 'table-empty' }, [
      el('p', { text: 'That list is not here any more.' }),
      el('a', { class: 'btn', href: '#/', text: 'Back to the table' }),
    ]));
    return;
  }

  const view = el('div', { class: 'sheet-view' });
  const sheet = el('div', { class: 'sheet', dataset: { paper: list.paper || 'plain' } });
  applySheetPalette(sheet, list.palette);

  add(sheet, header(list), body(list));
  add(view, sheet);
  add(scene, view, bar(list));
}

/* --- the header ----------------------------------------------------------- */

function header(list) {
  return el('header', { class: 'sheet-head' }, [
    editable('h1', {
      class: 'sheet-title',
      value: list.title,
      placeholder: 'Untitled list',
      onSave: (text) => store.updateList(list.id, { title: text || 'Untitled list' }),
    }),
    editable('div', {
      class: 'sheet-sub',
      value: list.subtitle,
      placeholder: 'A subtitle, if it needs one',
      onSave: (text) => store.updateList(list.id, { subtitle: text }),
    }),
    el('div', { class: 'sheet-meta' }, [
      el('span', {}, [
        el('span', { class: 'label', text: 'Date' }),
        el('input', {
          type: 'date',
          value: list.date || '',
          'aria-label': 'The date this list is for',
          onChange: (e) => store.updateList(list.id, { date: e.target.value }),
        }),
      ]),
      el('span', {}, [
        el('span', { class: 'label', text: 'Shop' }),
        el('input', {
          type: 'text',
          class: 'meta-text',
          value: list.store || '',
          placeholder: 'anywhere',
          'aria-label': 'Which shop',
          onChange: (e) => store.updateList(list.id, { store: e.target.value.trim() }),
        }),
      ]),
    ]),
  ]);
}

/* --- sections and items --------------------------------------------------- */

function body(list) {
  const wrap = el('div', { class: 'sheet-body' });

  for (const { section, items } of readingOrder(list)) {
    // The loose group at the top has no heading of its own, and is skipped
    // entirely once it is empty — an app should not show you a blank space
    // where a heading you never wrote would go.
    if (!section && !items.length && list.sections.length) continue;

    const group = el('section', { class: 'sheet-section' });
    if (section) add(group, sectionHead(list, section));

    const ul = el('ul', { class: 'items' }, items.map((item) => itemRow(list, item)));
    add(group, ul, newItemLine(list, section?.id || '', ul));
    add(wrap, group);
  }

  add(wrap, el('div', { class: 'section-add' }, [
    el('button', {
      class: 'btn btn-quiet btn-sm', type: 'button', text: '+ heading',
      onClick: () => {
        const section = store.addSection(list.id, 'New heading');
        // Straight into renaming it: a heading called "New heading" is not a
        // heading, it is a chore you have been handed.
        requestAnimationFrame(() => {
          const node = document.querySelector(`[data-section='${section.id}'] .section-label`);
          node?.focus();
          if (node) document.getSelection()?.selectAllChildren(node);
        });
      },
    }),
  ]));

  return wrap;
}

function sectionHead(list, section) {
  return el('div', { class: 'section-head', dataset: { section: section.id } }, [
    editable('h2', {
      class: 'section-label',
      value: section.label,
      placeholder: 'Heading',
      onSave: (text) => store.updateSection(list.id, section.id, { label: text || 'Heading' }),
    }),
    el('button', {
      class: 'btn btn-quiet btn-sm', type: 'button', text: 'remove',
      title: 'Remove this heading — what is under it stays',
      onClick: () => store.removeSection(list.id, section.id),
    }),
  ]);
}

function itemRow(list, item) {
  const row = el('li', {
    class: `item${item.done ? ' is-done' : ''}`,
    dataset: { item: item.id },
  });

  const tick = el('button', {
    class: 'item-tick',
    type: 'button',
    'aria-pressed': String(!!item.done),
    'aria-label': item.done ? `Put ${item.text} back` : `Cross off ${item.text}`,
    onClick: () => store.toggleItem(list.id, item.id),
  }, [checkSvg()]);

  const text = editable('span', {
    class: 'item-text',
    value: itemToText(item),
    placeholder: 'Something to buy',
    onSave: (typed) => {
      // An item emptied is an item deleted. Backspacing a line away is how
      // people remove things from a written list, and it would be strange to
      // leave an empty bullet sitting there instead.
      if (!typed) return store.removeItem(list.id, item.id);
      const next = retextItem(item, typed);
      return store.updateItem(list.id, item.id, next);
    },
  });

  /* The stroke lives in a holder that shrink-wraps the words, so it runs
     through the text and stops — a line carrying on across empty paper is
     what a text-decoration does, not what a pen does. */
  const hold = el('span', { class: 'item-hold' }, [text]);

  // Drawn, not a text-decoration line: four hand-wobbled paths picked by a
  // hash of the item's id, so no two crossings-out are identical and the same
  // item is always crossed the same way.
  if (item.done) add(hold, strikeSvg(Math.floor(hashUnit(item.id) * 4)));

  add(row, tick, hold);
  if (item.done && item.doneBy) {
    add(row, el('span', { class: 'by', text: shortName(item.doneBy) }));
  }

  return row;
}

/** An email down to something that fits beside an item. */
function shortName(email) {
  return String(email).split('@')[0].slice(0, 12);
}

function newItemLine(list, sectionId, ul) {
  const input = el('input', {
    type: 'text',
    placeholder: 'Add something',
    'aria-label': 'Add something to the list',
  });

  /* Typing a whole list in one go is the main way anyone uses this, so Enter
     adds and stays put.

     That means holding off the re-render. Saving fires a change, a change
     rebuilds this view, and the rebuild would replace the very input being
     typed into — which is how the first version of this lost focus after the
     first item and quietly swallowed the second and third. So the line claims
     the `editing` flag while it has focus and appends the new row itself; the
     next ordinary render, after blur, redraws it all properly anyway. */
  let release = null;
  input.addEventListener('focus', () => { release = claimBodyFlag('editing', input); });
  input.addEventListener('blur', () => { release?.(); release = null; });

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    const item = store.addItem(list.id, text, sectionId);
    input.value = '';
    if (item) {
      ul.append(itemRow(list, item));
      countUp(list);
    }
  });

  return el('div', { class: 'item-new', dataset: { add: sectionId || 'loose' } }, [input]);
}

/* The tally in the bar, kept honest while the re-render is held off. Without
   this it would sit at "0 of 2" through a dozen more items being typed. */
function countUp(list) {
  const { done, total } = progressOf(list);
  const node = document.querySelector('.sheet-bar .progress');
  if (node) node.textContent = total ? `${done} of ${total}` : 'nothing on it yet';
}

/* --- the bar of actions --------------------------------------------------- */

function bar(list) {
  const { done, total } = progressOf(list);

  return el('div', { class: 'sheet-bar' }, [
    iconLink('chevronLeft', 'Back to the table', '#/'),
    el('span', { class: 'progress', text: total ? `${done} of ${total}` : 'nothing on it yet' }),
    el('span', { class: 'spacer' }),
    done > 0 && el('button', {
      class: 'btn btn-secondary btn-sm', type: 'button', text: 'Clear crossed off',
      onClick: () => store.clearDone(list.id),
    }),
    iconButton('brush', 'How this sheet looks', { onClick: () => paperDialog(list) }),
    iconButton('share', 'Share this list', { onClick: () => toast('Sharing arrives in the next piece of work.') }),
    iconButton('trash', 'Throw this list away', { onClick: () => confirmDelete(list) }),
  ]);
}

function confirmDelete(list) {
  modal({
    title: 'Throw it away?',
    body: el('p', { text: `“${list.title}” and everything on it. This cannot be undone.` }),
    actions: [
      { label: 'Keep it' },
      {
        label: 'Throw it away',
        class: 'btn btn-danger',
        onClick: () => {
          store.deleteList(list.id);
          location.hash = '#/';
        },
      },
    ],
  });
}

/* Paper and colour, per sheet. The global palette in settings sets the tone
   for everything; this overrides it for one list, which is how you tell the
   week's shop from the party list at a glance on the table. */
function paperDialog(list) {
  const body = el('div', {});

  const stock = el('select', {}, PAPER_STOCKS.map((s) =>
    el('option', { value: s.id, text: s.label, selected: (list.paper || 'plain') === s.id })));
  stock.addEventListener('change', () => store.updateList(list.id, { paper: stock.value }));

  add(body, el('div', { class: 'field' }, [
    el('label', { class: 'label', text: 'Paper' }), stock,
  ]));

  for (const key of PALETTE_KEYS) {
    const input = el('input', {
      type: 'color',
      value: toHex(list.palette?.[key.id] || `var(--${key.id})`),
      'aria-label': key.label,
    });
    input.addEventListener('input', () => {
      store.updateList(list.id, { palette: { ...list.palette, [key.id]: input.value } });
    });

    add(body, el('div', { class: 'field swatch' }, [
      el('label', { class: 'label', text: `${key.label} — ${key.hint}` }),
      input,
      el('button', {
        class: 'btn btn-quiet btn-sm', type: 'button', text: 'default',
        onClick: () => {
          const next = { ...list.palette };
          delete next[key.id];
          store.updateList(list.id, { palette: next });
        },
      }),
    ]));
  }

  modal({ title: 'This sheet', body, actions: [{ label: 'Done', class: 'btn' }] });
}

/* --- editing in place ------------------------------------------------------ */

/**
 * A field you type straight into, on the paper.
 *
 * Three things matter here and each is a bug that has already been paid for
 * elsewhere:
 *
 * - `plaintext-only`, so pasting from a web page brings words and not markup.
 * - The `editing` flag, claimed on focus and released on blur, so a save from
 *   another tab (or, later, another person) cannot rebuild the node the caret
 *   is sitting in.
 * - Saving on blur and on Enter, never on every keystroke. Saving as you type
 *   means re-rendering as you type, and that is the same lost caret again.
 */
function editable(tag, { class: cls, value, placeholder, onSave }) {
  const node = el(tag, {
    class: cls,
    contenteditable: 'plaintext-only',
    role: 'textbox',
    'data-placeholder': placeholder,
    'aria-label': placeholder,
    text: value || '',
  });

  let release = null;

  node.addEventListener('focus', () => {
    release = claimBodyFlag('editing', node);
  });

  node.addEventListener('blur', () => {
    release?.();
    release = null;
    const text = node.textContent.trim();
    if (text !== (value || '').trim()) onSave(text);
  });

  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      node.blur();
    }
    if (event.key === 'Escape') {
      node.textContent = value || '';
      node.blur();
    }
  });

  return node;
}
