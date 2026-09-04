import { el, add } from '../lib/dom.js';
import { toHex, currentMode } from '../lib/theme.js';
import { store } from '../lib/store.js';

/* The colour pickers, shared by settings and by a single sheet.

   There are two sets of every colour — one for light, one for dark — because
   a paper chosen by daylight has no business being the paper at night. Rather
   than showing eight pickers at once, a small switch says which set you are
   editing, and it opens on whichever theme you are actually looking at. That
   keeps the choice honest: you change a colour while you can see it. */

export function paletteEditor({ keys, palette, onChange, small = false }) {
  const wrap = el('div', { class: 'palette-editor' });
  let mode = currentMode(store.state.settings);

  const modeSwitch = el('div', { class: 'seg palette-mode' });
  const body = el('div', { class: small ? 'tag-row' : '' });

  function paint() {
    modeSwitch.replaceChildren(...[['light', 'Light'], ['dark', 'Dark']].map(([id, label]) =>
      el('button', {
        class: 'seg-item',
        type: 'button',
        text: label,
        'aria-pressed': String(mode === id),
        onClick: () => { mode = id; paint(); },
      })));

    body.replaceChildren(...keys.map((key) => (small ? swatchSmall : swatch)(key)));
  }

  /** The colours for the set being edited, whatever shape arrived. */
  function set() {
    return palette()?.[mode] || {};
  }

  function write(id, value) {
    const current = palette() || {};
    const next = {
      light: { ...(current.light || {}) },
      dark: { ...(current.dark || {}) },
    };
    if (value) next[mode][id] = value;
    else delete next[mode][id];
    onChange(next);
  }

  /* The picker has to open on the colour that is actually in force, which is
     the sheet's own choice if it has one and the token underneath if not —
     otherwise "default" would look like black to anyone who opened it. */
  function startingHex(id) {
    return toHex(set()[id] || `var(--${id})`);
  }

  function swatch(key) {
    const input = el('input', {
      type: 'color', value: startingHex(key.id), 'aria-label': `${key.label}, ${mode}`,
    });
    input.addEventListener('input', () => write(key.id, input.value));

    return el('div', { class: 'field swatch' }, [
      el('label', { class: 'label', text: key.hint ? `${key.label} — ${key.hint}` : key.label }),
      input,
      el('button', {
        class: 'btn btn-quiet btn-sm', type: 'button', text: 'default',
        title: `Back to the built-in ${mode} colour`,
        onClick: () => { write(key.id, null); paint(); },
      }),
    ]);
  }

  function swatchSmall(key) {
    const input = el('input', {
      type: 'color',
      class: 'swatch-sm',
      value: startingHex(key.id),
      'aria-label': `${key.label}, ${mode}`,
      title: `${key.label} — ${mode}`,
    });
    input.addEventListener('input', () => write(key.id, input.value));
    return input;
  }

  paint();
  add(wrap, el('div', { class: 'palette-head' }, [
    el('span', { class: 'label', text: 'Editing' }), modeSwitch,
  ]), body);
  return wrap;
}
