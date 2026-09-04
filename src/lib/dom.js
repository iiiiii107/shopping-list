/* Tiny DOM helpers. Views build elements with `el()` rather than innerHTML so
   user-entered category and task names can never be parsed as markup. */

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style') node.style.cssText = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }

  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Namespaced element creation, for the inline SVG bits. */
export function svg(tag, props = {}, children = []) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

/**
 * Pointer capture, guarded. Browsers throw if the id isn't an active pointer,
 * and losing capture is never worth breaking the whole interaction over.
 */
export function capturePointer(node, pointerId) {
  try {
    node.setPointerCapture(pointerId);
  } catch {
    /* keep going without capture */
  }
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}

/**
 * Append children, skipping the empty ones.
 *
 * `el()` drops null and false from its children, but the DOM's own `append`
 * stringifies them — `body.append(cond && node)` puts the literal word "null"
 * on the page when `cond` is false. This makes the two behave the same.
 */
export function add(node, ...children) {
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function toast(message) {
  document.querySelector('.toast')?.remove();
  const node = el('div', { class: 'toast', role: 'status', text: message });
  document.body.append(node);
  setTimeout(() => node.remove(), 2600);
}

/** A modal with its own focus trap; resolves when closed. */
export function modal({ title, body, actions = [] }) {
  const previouslyFocused = document.activeElement;
  const backdrop = el('div', { class: 'modal-backdrop' });
  const panel = el('div', {
    class: 'modal paper',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
  });

  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    previouslyFocused?.focus?.();
  }
  function onKey(event) {
    if (event.key === 'Escape') close();
  }

  panel.append(el('h3', { text: title }), body);
  if (actions.length) {
    panel.append(
      el(
        'div',
        { class: 'modal-actions' },
        actions.map((action) =>
          el('button', {
            class: action.class || 'btn btn-secondary',
            text: action.label,
            onClick: () => {
              if (action.onClick?.({ close }) !== false) close();
            },
          }),
        ),
      ),
    );
  }

  backdrop.append(panel);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  panel.querySelector('input, textarea, select, button')?.focus();

  return { close, panel };
}

export function confetti(colors) {
  const layer = el('div', { class: 'confetti', 'aria-hidden': 'true' });
  for (let i = 0; i < 34; i += 1) {
    layer.append(
      el('i', {
        style: `left:${Math.random() * 100}%;
                top:${Math.random() * 18}%;
                background:${colors[i % colors.length]};
                animation-delay:${Math.random() * 0.35}s`,
      }),
    );
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 2200);
}

/** The hand-drawn strike-through, with a per-row wobble so no two match. */
export function strikeSvg(seed = 0) {
  const paths = [
    'M2 6C40 3 80 8 120 5C160 2 200 7 238 4',
    'M2 5C40 8 80 3 120 6C160 9 200 4 238 6',
    'M2 6C40 4 80 8 120 4C160 3 200 8 238 5',
    'M2 5C40 7 80 3 120 6C160 8 200 3 238 5',
  ];
  return svg(
    'svg',
    { class: 'strike', viewBox: '0 0 240 10', preserveAspectRatio: 'none' },
    [svg('path', { d: paths[seed % paths.length] })],
  );
}

export function checkSvg() {
  return svg('svg', { viewBox: '0 0 16 16' }, [
    svg('path', { d: 'M2.5 8.5l3.5 3.5 7.5-8' }),
  ]);
}

/** The pen, drawn to match the reference line art. */
export function penSvg() {
  const parts = [
    'M15.4 13.5C15.4 7.5 16.2 4.2 18.6 4.2C21 4.2 21.8 7.5 21.8 13.5Z',
    'M14.4 15.4C11 16.6 10 21.6 10 29.8C10 37.8 10.4 43.6 11.6 46.8C12.7 44.6 13 37.8 13 29.8C13 21.8 13.2 17.4 14.4 15.4Z',
    'M14.2 14.6C13.2 30 13 45 13.6 62.4L23.8 62.4C24.4 45 24.2 30 23.2 14.6Z',
    'M13.6 62.4C14 74 15 82.4 16.2 88.4L21.2 88.4C22.4 82.4 23.4 74 23.8 62.4Z',
    'M16.2 88.4C16.8 92 17.6 94.8 18.7 97.2C19.8 94.8 20.6 92 21.2 88.4Z',
  ];
  return svg(
    'svg',
    {
      class: 'pen',
      viewBox: '0 0 36 100',
      fill: 'none',
      stroke: 'var(--ink)',
      'stroke-width': '2.2',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      'aria-hidden': 'true',
    },
    parts.map((d) => svg('path', { d, fill: 'var(--paper)' })),
  );
}

/* --- cookbook additions ------------------------------------------------- */

/**
 * How to address whoever is signed in. The name comes from the Google account
 * once sync is on, or from the name field in settings before that; with
 * neither, it is simply "Chef" — the app has no business guessing.
 * @param {{name?: string}} [profile] settings.profile
 */
export function chefName(profile) {
  const first = String(profile?.name || '').trim().split(/\s+/)[0];
  return first ? `Chef ${first}` : 'Chef';
}

/* --- icons ---------------------------------------------------------------- */

/* Single-stroke line icons on a 24-grid, drawn here rather than pulled from a
   set so they share the weight of the rest of the interface. Stroke, width and
   colour all come from CSS. */
const ICONS = {
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z' +
    'M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.88 1.2V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3 15a1.7 1.7 0 0 0-1.55-1H1a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 3 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 7 4.6h.08A1.7 1.7 0 0 0 8.6 3V2a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 3 1.2l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.08a1.7 1.7 0 0 0 1.55 1.02H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  desk: 'M3 10.5 12 4l9 6.5M5.5 9.6V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.6',
  book: 'M4 4.6h6a2.4 2.4 0 0 1 2.4 2.4v12a1.8 1.8 0 0 0-1.8-1.8H4ZM20 4.6h-6A2.4 2.4 0 0 0 11.6 7v12a1.8 1.8 0 0 1 1.8-1.8H20Z',
  edit: 'M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20ZM13.5 7 17 10.5',
  plus: 'M12 5v14M5 12h14',
  check: 'M4.5 12.5 9.5 17.5 19.5 6.5',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M15 4.5v5M8 14.5v5',
  chevronLeft: 'M15 5 8 12l7 7',
  chevronRight: 'M9 5l7 7-7 7',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9ZM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z',
  share: 'M12 3v13M12 3 8 7M12 3l4 4M5 13v6a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6',
  inbox: 'M12 16V3M12 16l-4-4M12 16l4-4M5 13v6a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6',
  cart: 'M3 5h2.2l2.1 10.2a1.6 1.6 0 0 0 1.6 1.3h7.7a1.6 1.6 0 0 0 1.6-1.2L20 8.5H6.2M9.5 20.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM16.5 20.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  timer: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 9v4l2.5 2M9 2h6',
  flame: 'M12 22c3.9 0 6.5-2.5 6.5-6 0-4.5-4-6.5-4.5-11-3 2-4 4.5-4 7 0 1.2-.8 2-1.6 1.4C7.6 12.6 7 11.4 7 10c-1 1.4-1.5 3.4-1.5 6 0 3.5 2.6 6 6.5 6Z',
  brush: 'M9.5 14.5 4.6 19.4a2.2 2.2 0 0 0 3.1 3.1l4.9-4.9M9.5 14.5l4.6-4.6 4.5 4.5-4.6 4.6M14.1 9.9l4-4a2.4 2.4 0 0 1 3.4 3.4l-4 4',
  trash: 'M4.5 7h15M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L18 7',
};

/** An inline icon. Sizing and colour are the button's job, not the icon's. */
export function icon(name) {
  return svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [
    svg('path', { d: ICONS[name] || '' }),
  ]);
}

/**
 * An action reduced to its icon. The label is never dropped — it stays as the
 * accessible name and as the tooltip, so the button is still self-explanatory
 * without spending a word on it.
 */
export function iconButton(name, label, props = {}) {
  const { primary, ...rest } = props;
  // `false` is dropped by el(), which is right for most attributes but would
  // silently swallow `disabled: false` — so it is normalised here.
  if (rest.disabled === false) delete rest.disabled;
  return el(
    'button',
    {
      class: `btn-icon${primary ? ' is-primary' : ''}`,
      type: 'button',
      title: label,
      'aria-label': label,
      ...rest,
    },
    [icon(name)],
  );
}

/** The same, as a link. */
export function iconLink(name, label, href, props = {}) {
  return el('a', { class: 'btn-icon', href, title: label, 'aria-label': label, ...props }, [
    icon(name),
  ]);
}

/**
 * A small, stable pseudo-random number in [0,1) derived from a string. Used to
 * scatter the books on the desk: haphazard, but the same every time you look,
 * because an arrangement that reshuffled itself would be unsettling.
 */
export function hashUnit(text, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Stable-ish id. Random suffix plus the clock, so two devices don't collide. */
export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * Claim a flag on <body> for as long as this view is on screen.
 *
 * The flags that hold the background re-render (editing, cooking) used to be
 * plain "1"s cleared by whoever noticed their node had gone. When a view was
 * torn down and rebuilt, the *old* cleanup ran after the new view had already
 * set the flag and cleared it — leaving the new view unprotected and looking,
 * from the outside, exactly like the flag was never set.
 *
 * A token fixes it: only the render that set the flag can clear it.
 *
 * @param {string} name dataset key on <body>
 * @param {Node} node the view's root; the flag lifts when it leaves the page
 * @returns {() => void} release, for tearing down early
 */
export function claimBodyFlag(name, node) {
  const token = Math.random().toString(36).slice(2, 10);
  document.body.dataset[name] = token;

  const release = () => {
    observer.disconnect();
    // Someone else has claimed it since; leave theirs alone.
    if (document.body.dataset[name] !== token) return;
    delete document.body.dataset[name];
    /* Anyone holding something back until the typing stops needs to hear
       about it — otherwise a change that arrived from another person mid-word
       would sit in a queue until the next unrelated render. */
    document.dispatchEvent(new CustomEvent('bodyflag', { detail: { name } }));
  };

  const observer = new MutationObserver(() => {
    if (document.contains(node)) return;
    release();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return release;
}

/**
 * A drag, reduced to its essentials. Calls `onMove` with the pointer position
 * relative to `node`, and `onEnd` once. Pointer capture means the drag keeps
 * working when the pointer leaves the element, which matters on a small screen.
 */
export function drag(node, event, { onMove, onEnd } = {}) {
  capturePointer(node, event.pointerId);
  const box = node.getBoundingClientRect();
  const at = (e) => ({ x: e.clientX - box.left, y: e.clientY - box.top, box });

  function move(e) {
    if (e.pointerId !== event.pointerId) return;
    onMove?.(at(e), e);
  }
  function end(e) {
    if (e.pointerId !== event.pointerId) return;
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerup', end);
    node.removeEventListener('pointercancel', end);
    onEnd?.(at(e), e);
  }

  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  return at(event);
}
