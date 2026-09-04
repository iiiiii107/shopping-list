/* Turning settings into CSS.

   Every visual preference — palette, wood, paper, type — is expressed as a
   custom property or a data attribute on <html>, and nothing else in the app
   reads settings for styling. That is what makes "let the user pick the
   colours" a real feature rather than a handful of special cases: any token
   in tokens.css can be overridden here, and every rule that uses it follows.

   The cook book's window, blinds and lamp are deliberately absent. This app
   is used standing in a shop, and a shaft of sunlight across the page is not
   worth the contrast it costs there. */

export const PALETTE_KEYS = [
  { id: 'paper', label: 'Paper', hint: 'the sheet you write on' },
  { id: 'ink', label: 'Ink', hint: 'body text' },
  { id: 'accent', label: 'Accent', hint: 'headings, links and buttons' },
  { id: 'muted', label: 'Muted', hint: 'notes and captions' },
];

/* Six colours for the sheets themselves, where colour is doing a job —
   telling one list from another at a glance on the table. */
export const TAG_KEYS = [
  { id: 'tag-1', label: 'Sheet 1' },
  { id: 'tag-2', label: 'Sheet 2' },
  { id: 'tag-3', label: 'Sheet 3' },
  { id: 'tag-4', label: 'Sheet 4' },
  { id: 'tag-5', label: 'Sheet 5' },
  { id: 'tag-6', label: 'Sheet 6' },
];

const ALL_KEYS = [...PALETTE_KEYS, ...TAG_KEYS];

/** Ready-made palettes. Each is a partial override; anything absent stays. */
export const PRESETS = {
  slate: { label: 'Slate', vars: {} },  // the defaults, named so they can be chosen back
  olivegrove: {
    label: 'Olive Grove',
    vars: { paper: '#F8F7F0', ink: '#2C3025', accent: '#5F6B4A', muted: '#7F8271' },
  },
  verdigris: {
    label: 'Verdigris',
    vars: { paper: '#F7F9F7', ink: '#222B29', accent: '#47726A', muted: '#7C8886' },
  },
  charcoal: {
    label: 'Charcoal',
    vars: { paper: '#F8F8F7', ink: '#232323', accent: '#33312D', muted: '#87867F' },
  },
  clay: {
    label: 'Clay',
    vars: { paper: '#FAF7F2', ink: '#2B2825', accent: '#8A7B52', muted: '#8B8375' },
  },
};

export const WOODS = ['oak', 'walnut', 'pine', 'cherry', 'whitewash', 'ebony'];

export const FACES = {
  garamond: "'EB Garamond', 'Iowan Old Style', Georgia, serif",
  inter: "'Inter', -apple-system, 'Segoe UI', 'Helvetica Neue', sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
};

export const FACE_LABELS = { garamond: 'Garamond', inter: 'Inter', system: 'System' };

/** The paper a list is written on. */
export const PAPER_STOCKS = [
  { id: 'plain', label: 'Plain' },
  { id: 'ruled', label: 'Ruled' },
  { id: 'margin', label: 'Margin' },
  { id: 'grid', label: 'Grid' },
  { id: 'graph', label: 'Graph' },
  { id: 'dots', label: 'Dotted' },
  { id: 'aged', label: 'Aged' },
  { id: 'receipt', label: 'Receipt' },
];

/**
 * Push the whole of settings onto the document. Called at boot and after any
 * settings change; it is idempotent, so calling it twice costs nothing.
 */
export function applyTheme(settings = {}) {
  const root = document.documentElement;

  // "system" means leave the attribute off and let the media query decide.
  if (settings.theme === 'light' || settings.theme === 'dark') {
    root.dataset.theme = settings.theme;
  } else {
    delete root.dataset.theme;
  }

  root.dataset.wood = settings.wood || 'oak';

  // Palette overrides. Clearing a key has to remove the property outright,
  // or the last colour chosen would stick around forever.
  for (const { id } of ALL_KEYS) {
    const value = settings.palette?.[id];
    if (value) root.style.setProperty(`--${id}`, value);
    else root.style.removeProperty(`--${id}`);
  }

  root.style.setProperty('--font-display', FACES[settings.fontDisplay] || FACES.garamond);
  root.style.setProperty('--font-body', FACES[settings.fontBody] || FACES.inter);
  root.style.setProperty('--text-scale', String(settings.textScale ?? 1));
}

/**
 * A list's own colours, applied to the sheet element rather than the document.
 * A per-sheet palette is a small override on top of the global one, so a list
 * left alone simply follows whatever you chose in settings.
 */
export function applySheetPalette(node, palette = {}) {
  for (const { id } of PALETTE_KEYS) {
    const value = palette?.[id];
    if (value) node.style.setProperty(`--${id}`, value);
    else node.style.removeProperty(`--${id}`);
  }
}

/**
 * Resolve any CSS colour — a token reference, a name, an rgb() — to the plain
 * hex an <input type="color"> can open on. Canvas is doing the parsing, which
 * saves this file from knowing anything about colour syntax.
 */
export function toHex(value) {
  const raw = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;

  const resolved = raw.startsWith('var(')
    ? getComputedStyle(document.documentElement)
        .getPropertyValue(raw.slice(4, -1).trim())
        .trim()
    : raw;
  if (/^#[0-9a-f]{6}$/i.test(resolved)) return resolved;

  // getContext can return null — a headless page, or a browser with canvas
  // switched off. The cook book's settings screen crashed outright on this.
  const probe = document.createElement('canvas').getContext?.('2d');
  if (!probe) return '#000000';
  probe.fillStyle = '#000000';
  probe.fillStyle = resolved || '#000000';
  return probe.fillStyle;
}
