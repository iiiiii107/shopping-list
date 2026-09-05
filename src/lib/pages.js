import { el } from './dom.js';

/* Turning one long list into sheets of A4.

   The browser does the flowing. The content sits in a multi-column box whose
   column width is a page and whose height is a page, so each column *is* a
   page and the browser decides every break — no measuring loop, no deciding
   which item goes where, and nothing to get wrong when an item is edited into
   two lines.

   The part that matters most is what this does NOT do: it never moves a node.
   Re-flowing is a style change, so it can be run in the middle of typing and
   the caret stays exactly where it was. That is the whole reason for columns
   over measuring items and dealing them onto pages by hand.

   The pages themselves are drawn underneath as real elements, one per column,
   which is what makes them look like separate sheets on a table rather than
   one very wide one. The arithmetic below is what keeps the two in step. */

/** Below this, a list is one continuous strip you scroll — a phone, or an iPad held upright. */
export const PAGED_ABOVE = 900;

const RATIO = Math.SQRT2;   // A4: the long side over the short one
const GAP = 26;             // bare table showing between two sheets
/* The bar along the foot (57), the table showing above the paper (20), and a
   hair below it. Measured rather than guessed: the first attempt left 55px of
   bare wood under every page for no reason. */
const CHROME = 92;

/**
 * Lay a sheet out, in pages or as one strip, and keep the drawn pages in step
 * with the columns. Safe to call at any time, including mid-keystroke.
 *
 * @param {HTMLElement} sheet   the .sheet element
 * @param {{title?: string}} [meta] what to write at the head of a second page
 */
export function layout(sheet, meta = {}) {
  const flow = sheet.querySelector('.sheet-flow');
  const layer = sheet.querySelector('.sheet-pages');
  if (!flow || !layer) return 1;

  if (window.innerWidth < PAGED_ABOVE) return single(sheet, flow, layer);

  /* As much of the window as the paper can have. What is left is the bar at
     the foot and a margin of table around the edges — enough to read as paper
     lying on wood rather than as a document viewer, and no more. */
  const pageH = Math.max(420, Math.min(1040, window.innerHeight - CHROME));
  const pageW = Math.round(pageH / RATIO);
  const pad = Math.round(pageW * 0.085);

  sheet.classList.add('is-paged');
  sheet.classList.remove('paper-stock');

  /* Column width is the page minus its margins, and the gap carries those
     margins plus the bare table between sheets. That makes the pitch exactly
     one page plus one gap, which is what lets the drawn pages below line up
     with the columns by multiplication rather than by measuring them. */
  const colGap = GAP + pad * 2;

  const apply = (count) => {
    Object.assign(flow.style, {
      height: `${pageH}px`,
      padding: `${pad}px`,
      columnCount: String(count),
      columnWidth: 'auto',
      columnGap: `${colGap}px`,
      columnFill: 'auto',
      width: `${count * pageW + (count - 1) * GAP}px`,
    });
  };

  // One column first, to find out how tall the content really is.
  Object.assign(flow.style, {
    height: 'auto', columnCount: '1', width: `${pageW}px`, padding: `${pad}px`,
  });
  const usable = pageH - pad * 2;
  let count = Math.max(1, Math.ceil((flow.scrollHeight - pad * 2) / usable));

  apply(count);
  /* The division is a guess: an item that may not be split across a break
     pushes further than its own height. Grow until nothing overflows, with a
     ceiling so a pathological list cannot spin here forever. */
  for (let i = 0; i < 12 && flow.scrollWidth > flow.clientWidth + 1; i += 1) {
    count += 1;
    apply(count);
  }

  drawPages(sheet, layer, { count, pageW, pageH, title: meta.title });
  return count;
}

/** One continuous sheet: no columns, no drawn pages, just paper that grows. */
function single(sheet, flow, layer) {
  sheet.classList.remove('is-paged');
  sheet.classList.add('paper-stock');
  layer.replaceChildren();
  flow.removeAttribute('style');
  sheet.style.removeProperty('width');
  return 1;
}

function drawPages(sheet, layer, { count, pageW, pageH, title }) {
  sheet.style.width = `${count * pageW + (count - 1) * GAP}px`;
  sheet.style.height = `${pageH}px`;

  const paper = sheet.dataset.paper || 'plain';
  const pages = [];
  for (let i = 0; i < count; i += 1) {
    pages.push(el('div', {
      class: 'page paper-stock',
      dataset: { paper },
      style: `left:${i * (pageW + GAP)}px; width:${pageW}px; height:${pageH}px`,
    }, [
      /* A running head from the second page on. Page three of a shopping list
         with nothing on it to say which list it is would be a poor thing to
         be holding in a shop. */
      i > 0 && title && el('span', { class: 'page-head', text: title }),
      count > 1 && el('span', { class: 'page-num', text: String(i + 1) }),
    ]));
  }
  layer.replaceChildren(...pages);
}

/**
 * Re-lay a sheet whenever the window changes shape. Returns the way to stop,
 * which the view calls when its node leaves the page.
 */
export function keepLaidOut(sheet, meta) {
  const run = () => layout(sheet, meta);
  window.addEventListener('resize', run);
  return () => window.removeEventListener('resize', run);
}
