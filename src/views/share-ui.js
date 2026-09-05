import { el, add, modal, toast, hashUnit } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { currentAccount, syncConfigured } from '../lib/sync.js';
import { share, invite, uninvite, setLinkOpen, linkTo } from '../lib/share.js';

/* Letting somebody onto a list, and seeing that they are there.

   Two ways in, and the difference between them is real rather than cosmetic:
   an invitation is checked against the address on that person's own Google
   account, so knowing the link is not enough. "Anyone with the link" throws
   that away, which is sometimes exactly what you want — and is why it says so
   in a sentence rather than a footnote. */

/** The faces of whoever else has this list open right now. */
export function whoElse(people = []) {
  const node = el('span', { class: 'who' });
  if (!people.length) return node;

  for (const person of people.slice(0, 4)) {
    node.append(person.photo
      ? el('img', { class: 'face', src: person.photo, alt: '', title: `${person.name} is here` })
      : el('span', {
          class: 'face initial',
          title: `${person.name} is here`,
          style: `background: var(--tag-${Math.floor(hashUnit(person.uid) * 6) + 1})`,
          text: (person.name || '?').trim()[0].toUpperCase(),
        }));
  }
  if (people.length > 4) node.append(el('span', { class: 'face more', text: `+${people.length - 4}` }));
  node.append(el('span', { class: 'sr-only', text: `${people.length} other people have this list open` }));
  return node;
}

export function shareDialog(list, api) {
  if (!syncConfigured() || !currentAccount()) {
    return modal({
      title: 'Share this list',
      body: el('div', {}, [
        el('p', { text: 'Sign in with Google and you can put somebody else on this list. You will both see the same one, and either of you can cross things off.' }),
        el('p', { class: 'note', text: 'Without signing in you can still send it as a file — it just will not stay in step afterwards.' }),
      ]),
      actions: [
        { label: 'Not now' },
        { label: 'Sign in', class: 'btn', onClick: () => { location.hash = '#/settings'; } },
      ],
    });
  }

  if (!list.shared) return offerToShare(list);
  return manage(list, api);
}

/* Sharing moves the list rather than copying it: it stops being a row in your
   own blob and becomes a document of its own with an item beneath it for
   every line. Two homes for one list would be two sources of truth. */
function offerToShare(list) {
  const status = el('p', { class: 'note' });

  const dialog = modal({
    title: `Share “${list.title}”`,
    body: el('div', {}, [
      el('p', { text: 'The list moves out of this browser and onto the two of you. You will both see the same one, live — items appear as they are written and crossings-out as they happen.' }),
      el('p', { class: 'note', text: 'It stays yours: only you can let anyone else on, or throw it away. You send them the link yourself — nothing is emailed.' }),
      status,
    ]),
    actions: [
      { label: 'Not yet' },
      {
        label: 'Share it',
        class: 'btn',
        onClick: async () => {
          status.textContent = 'Moving it…';
          try {
            const id = await share(list);
            // Only once it is safely up: losing the local copy first would
            // lose the list if the write failed.
            await store.deleteList(list.id);
            location.hash = `#/list/${id}?shared=1`;
          } catch (err) {
            console.warn('Could not share the list.', err);
            status.textContent = 'That did not work. The list is still here and unchanged.';
            return false;
          }
          return true;
        },
      },
    ],
  });
  return dialog;
}

function manage(list, api) {
  const me = currentAccount();
  const owner = list.owner === me.uid;
  const body = el('div', { class: 'share-manage' });

  add(body, el('p', { class: 'label', text: 'On this list' }));
  add(body, el('ul', { class: 'people' }, [
    ...(list.members || []).map((uid) => el('li', {
      text: uid === me.uid ? 'You' : shortId(uid),
    })),
    ...(list.invited || []).map((email) => el('li', { class: 'pending' }, [
      el('span', { text: email }),
      el('span', { class: 'note', text: 'invited' }),
      owner && el('button', {
        class: 'btn btn-quiet btn-sm', type: 'button', text: 'withdraw',
        onClick: async () => {
          await uninvite(list.id, email).catch(() => toast('That did not work.'));
        },
      }),
    ])),
  ]));

  if (owner) {
    const email = el('input', { type: 'email', placeholder: 'their@gmail.com', 'aria-label': 'Their Google address' });
    add(body, el('div', { class: 'field' }, [
      el('label', { class: 'label', text: 'Invite by address' }),
      el('div', { class: 'row' }, [
        email,
        el('button', {
          class: 'btn btn-secondary', type: 'button', text: 'Invite',
          onClick: async () => {
            const value = email.value.trim();
            if (!value.includes('@')) return toast('That does not look like an address.');
            try {
              await invite(list.id, value);
              email.value = '';
              // Said plainly, because the first version implied an email had
              // gone out and none had — the person waited for a message that
              // was never coming.
              toast('Added. Now send them the link — nothing is emailed.');
            } catch {
              toast('That did not work.');
            }
          },
        }),
      ]),
      el('p', { class: 'note', text: 'Nothing is emailed — there is no server here to send it. Inviting them makes the list openable by that Google account; you still have to send them the link yourself, below.' }),
    ]));

    const open = el('input', { type: 'checkbox', checked: !!list.linkOpen });
    open.addEventListener('change', async () => {
      try {
        await setLinkOpen(list.id, open.checked);
      } catch {
        open.checked = !open.checked;
        toast('That did not work.');
      }
    });
    add(body, el('div', { class: 'field' }, [
      el('label', { class: 'check' }, [open, el('span', { text: 'Anyone with the link can open it' })]),
      el('p', { class: 'note', text: 'Turn this on and the link is the password. Forwarded once, it is open to whoever has it — which is fine for people you live with and worth thinking about otherwise.' }),
    ]));
  }

  const link = linkTo(list.id);
  const field = el('input', { type: 'text', value: link, readonly: true, 'aria-label': 'The link to this list' });
  add(body, el('div', { class: 'field share-link' }, [
    el('label', { class: 'label', text: 'Send them this' }),
    el('div', { class: 'row' }, [
      field,
      el('button', {
        class: 'btn', type: 'button', text: 'Copy link',
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(link);
            toast('Copied. Send it however you like.');
          } catch {
            field.select();
            toast('Press copy — the link is selected.');
          }
        },
      }),
    ]),
    el('p', { class: 'note', text: 'However you send it — a message, a note on the fridge. Whoever you invited can open it; nobody else can unless the switch above is on.' }),
  ]));

  return modal({ title: `“${list.title}”`, body, actions: [{ label: 'Done', class: 'btn' }] });
}

/* Somebody on the list whose name we have not got. Only the owner's own
   account is readable to us — Firestore holds ids, not a directory — so
   rather than inventing a name it shows what it actually knows. */
function shortId(uid) {
  return `Someone (${String(uid).slice(0, 6)})`;
}
