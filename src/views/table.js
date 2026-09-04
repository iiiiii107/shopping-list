import { el, add, icon, iconButton, iconLink, modal, hashUnit, chefName, toast } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { sortLists, progressOf, readingOrder, itemToText } from '../lib/list.js';
import { PAPER_STOCKS } from '../lib/theme.js';
import { importDialog } from './transfer.js';

/* The table: every list you have, lying about as sheets of paper.

   The scatter is derived from each list's id rather than from Math.random, so
   the arrangement is the same every time you open the app. Paper that shuffles
   itself on each reload reads as a bug, not as charm. */

export function renderTable(scene) {
  const lists = sortLists(store.state.lists);

  add(scene, head(), lists.length ? sheets(lists) : empty());
}

function head() {
  return el('div', { class: 'table-head' }, [
    el('h1', { text: 'Shopping' }),
    el('span', { class: 'greeting', text: greeting() }),
    el('div', { class: 'table-actions' }, [
      iconButton('inbox', 'Bring in a list', { onClick: importList }),
      iconButton('plus', 'New list', { primary: true, onClick: () => newListDialog() }),
      iconLink('settings', 'Settings', '#/settings'),
    ]),
  ]);
}

function greeting() {
  const { lists, settings } = store.state;
  const left = lists.reduce((n, list) => n + progressOf(list).total - progressOf(list).done, 0);
  if (!lists.length) return `Nothing to buy yet, ${chefName(settings.profile)}`;
  if (!left) return 'Everything crossed off';
  return `${left} still to find`;
}

function empty() {
  return el('div', { class: 'table-empty' }, [
    el('p', { text: 'An empty table. Start a list and it will lie here waiting.' }),
    el('button', {
      class: 'btn', type: 'button', text: 'Start a list',
      onClick: () => newListDialog(),
    }),
  ]);
}

function sheets(lists) {
  return el('div', { class: 'sheets' }, lists.map(card));
}

function card(list) {
  const { done, total } = progressOf(list);

  // Deterministic scatter: a tilt and a nudge derived from the list's own id.
  const tilt = (hashUnit(list.id, 1) - 0.5) * 4.4;
  const nudge = (hashUnit(list.id, 2) - 0.5) * 18;
  const tag = `var(--tag-${Math.floor(hashUnit(list.id, 3) * 6) + 1})`;

  // The first few things on it, so the table is readable without opening
  // anything — which is the point of leaving paper lying out.
  const peek = readingOrder(list)
    .flatMap((group) => group.items)
    .slice(0, 5);

  const node = el('button', {
    class: 'sheet-card',
    type: 'button',
    style: `--tilt:${tilt.toFixed(2)}deg; --nudge:${nudge.toFixed(1)}px; --sheet-tag:${tag}`,
    dataset: { paper: list.paper || 'plain' },
    onClick: () => { location.hash = `#/list/${list.id}`; },
  }, [
    el('h2', { text: list.title }),
    list.subtitle && el('div', { class: 'sub', text: list.subtitle }),
    el('ul', { class: 'peek' }, peek.map((item) => el('li', {
      class: item.done ? 'is-done' : '',
      text: itemToText(item),
    }))),
    el('div', { class: 'count' }, [
      el('span', { text: total ? `${done}/${total}` : 'empty' }),
      list.shared && el('span', { class: 'shared-mark', text: 'shared' }),
    ]),
  ]);

  return node;
}

/* --- making one ----------------------------------------------------------- */

export function newListDialog(onDone) {
  const title = el('input', { type: 'text', value: '', placeholder: 'Weekly shop' });
  const paper = el('select', {}, PAPER_STOCKS.map((stock) =>
    el('option', { value: stock.id, text: stock.label })));

  const body = el('div', {}, [
    el('div', { class: 'field' }, [
      el('label', { class: 'label', text: 'Name' }), title,
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'label', text: 'Paper' }), paper,
    ]),
  ]);

  modal({
    title: 'A new list',
    body,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Start it',
        class: 'btn',
        onClick: () => {
          const list = store.addList({
            title: title.value.trim() || 'Shopping list',
            paper: paper.value,
          });
          if (onDone) onDone(list);
          else location.hash = `#/list/${list.id}`;
        },
      },
    ],
  });
}

/* Importing is deliberately reachable from here as well as from inside a
   list, because the two mean different things: from the table a file becomes
   a new sheet, from inside a list it is added to the one already open. */
function importList() {
  importDialog();
}
