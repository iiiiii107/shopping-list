import { el, add, modal, toast } from '../lib/dom.js';
import { store } from '../lib/store.js';
import {
  toMarkdown, sectionToMarkdown, listFromMarkdown, mergeMarkdown, fileNameFor,
} from '../lib/md.js';
import { readingOrder, progressOf } from '../lib/list.js';

/* Sending a list somewhere, and bringing one back.

   Markdown because it is the format that survives being sent to a person. A
   `- [ ]` list is readable in a message, in Notes, in Obsidian, and tickable
   in several of them — and it comes back in here without losing the
   quantities, which is what lets two lists merge without doubling anything up.

   Bringing one in is deliberately offered in two places, because the two mean
   different things. From the table, a file becomes a new sheet. From inside a
   list, it is added to the one already open — which is how you are handed
   "the vegetables" by somebody and put them where they belong. */

/* --- out ------------------------------------------------------------------ */

/**
 * Hand a list over: share it if the device can, otherwise offer the file and
 * the text. Sharing is tried first on purpose — on a phone it puts the list
 * straight into a message, which is how these actually travel.
 */
export async function shareList(list) {
  const md = toMarkdown(list);
  const name = fileNameFor(list);

  if (navigator.canShare && navigator.share) {
    const file = new File([md], name, { type: 'text/markdown' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: list.title });
        return;
      } catch (err) {
        // Cancelled, which is a perfectly good answer and not an error.
        if (err?.name === 'AbortError') return;
      }
    }
  }

  sendDialog(list, md, name);
}

function sendDialog(list, md, name) {
  const { done, total } = progressOf(list);

  const preview = el('textarea', { class: 'md-preview', rows: '10', readonly: true });
  preview.value = md;

  const body = el('div', {}, [
    el('p', { class: 'note', text: `${total} thing${total === 1 ? '' : 's'} on it, ${done} crossed off. It travels as words — paper and colours stay here.` }),
    preview,
  ]);

  const dialog = modal({
    title: `Send “${list.title}”`,
    body,
    actions: [
      { label: 'Close' },
      {
        label: 'Copy',
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(md);
            toast('Copied.');
          } catch {
            // No clipboard permission. The text is on screen and selectable,
            // which is the whole reason it is on screen.
            preview.select();
            toast('Press copy — the list is selected.');
          }
          return false;
        },
      },
      { label: 'Download', class: 'btn', onClick: () => download(md, name) },
    ],
  });

  /* The modal puts the caret in the first field it finds, which here is the
     preview — and that scrolls it to the end, so the dialog opened showing the
     last three items of the list rather than its name. */
  preview.scrollTop = 0;
  preview.setSelectionRange(0, 0);
  return dialog;
}

/** One section of a list, for sending somebody just the vegetables. */
export function sendSection(list, sectionId, label) {
  const md = sectionToMarkdown(list, sectionId);
  if (!md) return toast('There is nothing under that heading yet.');
  return sendDialog({ ...list, title: label }, md, `${fileNameFor(list).slice(0, -3)}-${label.toLowerCase().replace(/\W+/g, '-')}.md`);
}

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* --- in ------------------------------------------------------------------- */

/**
 * The one dialog both entry points use. A file or pasted words, read by the
 * same parser either way — the paste box is not a lesser option, it is how a
 * list arrives when somebody sends it in a message.
 *
 * @param {object} [target] the list to add to; absent, a new sheet is made
 */
export function importDialog(target = null) {
  const paste = el('textarea', {
    class: 'md-paste',
    rows: '7',
    placeholder: '- [ ] 250 ml milk\n- [ ] 3 apples\n\n…or paste anything list-shaped',
    'aria-label': 'Paste a list',
  });

  const file = el('input', { type: 'file', accept: '.md,.markdown,.txt,text/markdown,text/plain' });
  file.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    paste.value = await chosen.text();
    // Naming the list after the file is better than "Shopping list" when the
    // file never names itself.
    paste.dataset.name = chosen.name.replace(/\.(md|markdown|txt)$/i, '');
    status.textContent = `Read ${chosen.name}.`;
  });

  const status = el('p', { class: 'note' });

  /* Where it lands, when there is already a list open. Its own headings by
     default — a file that says "Freezer" knows better than we do. */
  /* Three distinct answers, so they need three distinct values: keep the
     file's headings, put it all straight on the list with no heading, or put
     it all under one heading that is already there. Folding the first two
     together would silently throw away the file's own headings. */
  let where = 'own';
  const wherePicker = target ? sectionPicker(target, (value) => { where = value; }) : null;

  const body = el('div', { class: 'import-form' }, [
    el('div', { class: 'field' }, [
      el('label', { class: 'label', text: 'From a file' }),
      file,
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'label', text: 'Or paste it' }),
      paste,
    ]),
    wherePicker,
    status,
  ]);

  modal({
    title: target ? `Add to “${target.title}”` : 'Bring in a list',
    body,
    actions: [
      { label: 'Cancel' },
      {
        label: target ? 'Add it' : 'Make the sheet',
        class: 'btn',
        onClick: () => {
          const text = paste.value;
          if (!text.trim()) {
            status.textContent = 'Choose a file, or paste something.';
            return false;
          }

          if (target) {
            const patch = mergeMarkdown(target, text, {
              intoSection: where === 'own' ? null : (where === 'loose' ? '' : where),
            });
            if (!patch) {
              status.textContent = 'There was nothing on that page to bring in.';
              return false;
            }
            store.updateList(target.id, patch);
            toast('Added.');
            return true;
          }

          const list = listFromMarkdown(text, paste.dataset.name || 'Shopping list');
          if (!list) {
            status.textContent = 'There was nothing on that page to bring in.';
            return false;
          }
          const saved = store.addList(list);
          location.hash = `#/list/${saved.id}`;
          return true;
        },
      },
    ],
  });
}

function sectionPicker(list, onPick) {
  const select = el('select', { 'aria-label': 'Where it should go' }, [
    el('option', { value: 'own', text: 'Keep its own headings' }),
    el('option', { value: 'loose', text: 'Straight onto the list' }),
    ...readingOrder(list)
      .filter((g) => g.section)
      .map((g) => el('option', { value: g.section.id, text: `Under “${g.section.label}”` })),
  ]);
  select.addEventListener('change', () => onPick(select.value));

  return el('div', { class: 'field' }, [
    el('label', { class: 'label', text: 'Where it goes' }),
    select,
  ]);
}
