import { orderBetween } from './list.js';

/* Dragging one thing past another.

   Position is worked out by asking what is under the pointer rather than by
   comparing coordinates, because both places this is used lay their contents
   out in ways coordinates cannot be trusted for: the sheets on the table wrap
   onto several rows, and a list's headings flow across A4 columns, so "higher
   up the screen" and "earlier in the list" are not the same thing.

   `document.elementFromPoint` is exactly right for that, on one condition —
   nothing may cover the page while the drag is happening. The cook book's
   eraser is broken for want of that condition: it asks what is under the
   cursor and gets back the drawing surface it laid over everything. So the
   thing being dragged is lifted with a transform and made transparent to the
   pointer, and nothing else is put on top. */

/**
 * Make a row draggable among its siblings.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.handle    what you take hold of
 * @param {HTMLElement} opts.node      what moves
 * @param {string} opts.selector       what counts as a sibling, e.g. '.sheet-card'
 * @param {'x'|'y'} opts.axis          which half of a sibling decides before or after
 * @param {() => object[]} opts.list   the items, in their current order
 * @param {string} opts.id             the id of the one being dragged
 * @param {(row: object) => number} [opts.orderOf]  where a row's order lives
 * @param {(id: string, order: number) => void} opts.onDrop
 */
export function draggableRow({
  handle, node, selector, axis, list, id, onDrop,
  /* Headings keep their order on themselves; sheets on the table keep theirs
     in a map in settings, because that arrangement is personal and must not
     be written onto a list shared with other people. So where to find it is
     the caller's business. Reading `.order` blindly gave every sheet the same
     number and rearranged nothing. */
  orderOf = (row) => row?.order,
}) {
  handle.addEventListener('pointerdown', (event) => {
    // Left button or a touch, never a right-click or the middle one.
    if (event.button !== 0) return;
    event.preventDefault();

    const start = { x: event.clientX, y: event.clientY };
    let target = null;      // { id, before }
    let moved = false;

    const marker = () => {
      for (const el of document.querySelectorAll('.drop-before, .drop-after')) {
        el.classList.remove('drop-before', 'drop-after');
      }
      if (!target) return;
      const el = document.querySelector(`[data-reorder="${target.id}"]`);
      el?.classList.add(target.before ? 'drop-before' : 'drop-after');
    };

    const move = (e) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      // A few pixels of slop, so a click on the handle is still a click.
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;

      if (!moved) {
        moved = true;
        node.classList.add('is-lifting');
        // Transparent to the pointer, or every hit test would find the thing
        // being dragged and nothing else.
        node.style.pointerEvents = 'none';
        document.body.classList.add('is-reordering');
      }
      node.style.transform = `translate(${dx}px, ${dy}px)`;

      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest(selector);
      const overId = under?.dataset.reorder;
      if (!under || !overId || overId === id) { target = null; return marker(); }

      const box = under.getBoundingClientRect();
      const before = axis === 'x'
        ? e.clientX < box.left + box.width / 2
        : e.clientY < box.top + box.height / 2;
      target = { id: overId, before };
      marker();
    };

    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);

      node.classList.remove('is-lifting');
      node.style.pointerEvents = '';
      node.style.transform = '';
      document.body.classList.remove('is-reordering');
      const dropping = target;
      target = null;
      marker();

      if (!moved || !dropping) return;

      /* The order value is worked out from the neighbours the dropped thing
         lands between, which is the whole reason order is a float: one number
         changes and nothing else has to be renumbered. */
      const rows = list();
      const at = rows.findIndex((r) => r.id === dropping.id);
      if (at < 0) return;

      const above = dropping.before ? rows[at - 1] : rows[at];
      const below = dropping.before ? rows[at] : rows[at + 1];
      // Dropping either side of where it already is changes nothing.
      if (above?.id === id || below?.id === id) return;

      const asOrder = (row) => (row ? { order: orderOf(row) } : null);
      onDrop(id, orderBetween(asOrder(above), asOrder(below)));
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
}
