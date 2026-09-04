import { el, add, iconLink, toast } from '../lib/dom.js';
import { store } from '../lib/store.js';
import {
  applyTheme, toHex, PALETTE_KEYS, TAG_KEYS, PRESETS, WOODS, FACES, FACE_LABELS,
} from '../lib/theme.js';
import { storage } from '../lib/storage.js';

/* Settings.

   Every colour in the app is a custom property, and this screen writes those
   properties onto <html>. That is what makes "let me pick the colours" a real
   feature rather than a handful of special cases — nothing anywhere else
   hard-codes a colour, so anything you change here reaches everything. */

export function renderSettings(scene) {
  const { settings } = store.state;

  const page = el('div', { class: 'settings' }, [
    el('div', { class: 'table-head' }, [
      el('h1', { text: 'Settings' }),
      el('div', { class: 'table-actions' }, [
        iconLink('chevronLeft', 'Back to the table', '#/'),
      ]),
    ]),
    el('div', { class: 'settings-sheet' }, [
      section('You', [
        field('Name', el('input', {
          type: 'text',
          value: settings.profile?.name || '',
          placeholder: 'Chef',
          onChange: (e) => save({
            profile: { ...settings.profile, name: e.target.value.trim() },
          }),
        }), 'Used only to greet you. Left empty, the app just says “Chef”.'),
      ]),

      section('Light', [
        field('Theme', segmented(
          [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']],
          settings.theme,
          (value) => save({ theme: value }),
        )),
      ]),

      section('The table', [
        field('Wood', segmented(
          WOODS.map((w) => [w, w[0].toUpperCase() + w.slice(1)]),
          settings.wood,
          (value) => save({ wood: value }),
        )),
      ]),

      section('Colour', [
        field('Ready-made', segmented(
          Object.entries(PRESETS).map(([id, p]) => [id, p.label]),
          currentPreset(settings),
          (value) => save({ palette: { ...PRESETS[value].vars } }),
        ), 'A starting point. Anything below can still be changed on its own.'),
        ...PALETTE_KEYS.map((key) => swatch(key, settings)),
        el('p', { class: 'note', text: 'Sheet colours — how one list is told from another on the table.' }),
        el('div', { class: 'tag-row' }, TAG_KEYS.map((key) => swatchSmall(key, settings))),
      ]),

      section('Type', [
        field('Headings', segmented(
          Object.keys(FACES).map((id) => [id, FACE_LABELS[id]]),
          settings.fontDisplay,
          (value) => save({ fontDisplay: value }),
        )),
        field('Body', segmented(
          Object.keys(FACES).map((id) => [id, FACE_LABELS[id]]),
          settings.fontBody,
          (value) => save({ fontBody: value }),
        )),
        field('Size', el('input', {
          type: 'range', min: '0.85', max: '1.35', step: '0.05',
          value: String(settings.textScale ?? 1),
          'aria-label': 'Text size',
          onInput: (e) => save({ textScale: Number(e.target.value) }),
        })),
      ]),

      section('Your cookbook', [
        field('Where it lives', el('input', {
          type: 'url',
          value: settings.cookbookUrl || '',
          placeholder: 'https://…',
          onChange: (e) => save({ cookbookUrl: e.target.value.trim() }),
        }), 'Where the book at the corner of the table takes you.'),
      ]),

      section('Everything, as a file', [
        el('div', { class: 'row' }, [
          el('button', { class: 'btn btn-secondary', type: 'button', text: 'Export a backup', onClick: exportBackup }),
          el('button', { class: 'btn btn-secondary', type: 'button', text: 'Restore a backup', onClick: importBackup }),
        ]),
        el('p', { class: 'note', text: 'Every list and every setting, as one file. Restoring replaces what is here.' }),
      ]),
    ]),
  ]);

  add(scene, page);
}

async function save(patch) {
  await store.updateSettings(patch);
  applyTheme(store.state.settings);
}

function section(title, children) {
  return el('section', { class: 'settings-group' }, [
    el('h2', { text: title }),
    ...children,
  ]);
}

function field(label, control, note) {
  return el('div', { class: 'field' }, [
    el('label', { class: 'label', text: label }),
    control,
    note && el('p', { class: 'note', text: note }),
  ]);
}

function segmented(options, current, onPick) {
  return el('div', { class: 'seg' }, options.map(([value, label]) =>
    el('button', {
      class: 'seg-item',
      type: 'button',
      text: label,
      'aria-pressed': String(current === value),
      onClick: () => onPick(value),
    })));
}

/* Which preset the current palette matches, if any. Without this the preset
   row would show nothing selected the moment you changed one colour by hand,
   and you could not find your way back to a named starting point. */
function currentPreset(settings) {
  const palette = settings.palette || {};
  for (const [id, preset] of Object.entries(PRESETS)) {
    const keys = Object.keys(preset.vars);
    if (!keys.length && !Object.keys(palette).length) return id;
    if (keys.length && keys.every((k) => palette[k] === preset.vars[k])) return id;
  }
  return '';
}

function swatch(key, settings) {
  const input = el('input', {
    type: 'color',
    value: toHex(settings.palette?.[key.id] || `var(--${key.id})`),
    'aria-label': key.label,
  });
  input.addEventListener('input', () => {
    save({ palette: { ...store.state.settings.palette, [key.id]: input.value } });
  });

  return el('div', { class: 'field swatch' }, [
    el('label', { class: 'label', text: `${key.label} — ${key.hint}` }),
    input,
    el('button', {
      class: 'btn btn-quiet btn-sm', type: 'button', text: 'default',
      onClick: () => {
        const next = { ...store.state.settings.palette };
        delete next[key.id];
        save({ palette: next });
        input.value = toHex(`var(--${key.id})`);
      },
    }),
  ]);
}

function swatchSmall(key, settings) {
  const input = el('input', {
    type: 'color',
    class: 'swatch-sm',
    value: toHex(settings.palette?.[key.id] || `var(--${key.id})`),
    'aria-label': key.label,
    title: key.label,
  });
  input.addEventListener('input', () => {
    save({ palette: { ...store.state.settings.palette, [key.id]: input.value } });
  });
  return input;
}

/* --- backup --------------------------------------------------------------- */

async function exportBackup() {
  const json = await storage.exportAll();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const a = el('a', { href: url, download: `shopping-list-${stamp}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importBackup() {
  const input = el('input', { type: 'file', accept: 'application/json,.json' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await storage.importAll(await file.text());
      applyTheme(store.state.settings);
      toast('Restored.');
    } catch (err) {
      console.warn('That backup could not be read.', err);
      toast('That file could not be read as a backup.');
    }
  });
  input.click();
}
