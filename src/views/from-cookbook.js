import { el, add, modal, toast } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { readCookbook, listFromWeek, weeks, spanOf } from '../lib/cookbook.js';
import { syncConfigured, currentAccount } from '../lib/sync.js';

/* "Build a list from this week."

   The everyday path between the two apps, and the reason it needs no file:
   you are signed into the same account in both, so this reads your own meal
   plan straight out of the database. Nothing to export, nothing to open,
   nothing in the cook book had to change to allow it.

   The .md import stays for everything else — a list from a friend, a list
   from anywhere that is not your own cook book. */

export function canReadCookbook() {
  return syncConfigured() && !!currentAccount();
}

export async function fromCookbookDialog() {
  if (!canReadCookbook()) {
    return modal({
      title: 'From your cookbook',
      body: el('div', {}, [
        el('p', { text: 'Sign in with the same Google account you use for the cookbook, and this will read your meal plan straight out of it.' }),
        el('p', { class: 'note', text: 'Until then you can still export a list from the cookbook and bring the file in here.' }),
      ]),
      actions: [
        { label: 'Not now' },
        { label: 'Settings', class: 'btn', onClick: () => { location.hash = '#/settings'; } },
      ],
    });
  }

  // Reading is a round trip, so say so rather than leaving a dead button.
  const status = el('p', { class: 'note', text: 'Reading your cookbook…' });
  const body = el('div', { class: 'cookbook-form' }, [status]);
  const dialog = modal({
    title: 'From your cookbook',
    body,
    actions: [{ label: 'Close' }],
  });

  let cookbook;
  try {
    cookbook = await readCookbook();
  } catch (err) {
    console.warn('Could not read the cookbook.', err);
    status.textContent = 'Your cookbook could not be read just now. It may be a connection.';
    return dialog;
  }

  if (!cookbook) {
    status.textContent = 'There is no cookbook on this account yet — nothing to read.';
    return dialog;
  }

  /* Only the weeks with something planned on them. Offering three weeks when
     two of them are empty is offering two dead ends. */
  const options = weeks()
    .map((week) => ({ ...week, list: listFromWeek(cookbook, { dates: week.dates }) }))
    .filter((week) => week.list);

  if (!options.length) {
    status.textContent = 'Nothing is planned in the cookbook for last week, this week or next.';
    return dialog;
  }

  status.remove();
  add(body, ...options.map((week) => {
    const count = week.list.items.length;
    return el('button', {
      class: 'week-option',
      type: 'button',
      onClick: () => {
        const saved = store.addList({
          ...week.list,
          title: `${week.label}'s shop`,
        });
        dialog.close();
        location.hash = `#/list/${saved.id}`;
      },
    }, [
      el('strong', { text: week.label }),
      el('span', { class: 'note', text: spanOf(week.dates) }),
      el('span', { class: 'note', text: `${count} thing${count === 1 ? '' : 's'} to buy, across ${week.list.sections.length} heading${week.list.sections.length === 1 ? '' : 's'}` }),
    ]);
  }));

  return dialog;
}
