/* What the planning sheet covers.

   Three weeks and no more: the one just gone, the one we are in, and the one
   coming. That is the whole of it — you can look back at what you cooked, see
   what is happening now, and get ahead by a week. Anything outside that window
   is forgotten, so the plan never grows without limit and never syncs years of
   stale data to a device that has no use for it.

   The rule lives here rather than inside the store so that the tests can
   exercise the real thing. A pruning rule that deletes data should not be
   verified against a second copy of itself. */

import { todayISO, addDays, startOfWeek } from './dates.js';

export const WEEKS_BACK = 1;
export const WEEKS_FORWARD = 1;

/** The Mondays of every week the sheet can show, oldest first. */
export function weekStarts(today = todayISO()) {
  const here = startOfWeek(today, 1);
  const out = [];
  for (let i = -WEEKS_BACK; i <= WEEKS_FORWARD; i += 1) out.push(addDays(here, i * 7));
  return out;
}

/** The first and last dates worth keeping, inclusive. */
export function planWindow(today = todayISO()) {
  const weeks = weekStarts(today);
  return { first: weeks[0], last: addDays(weeks[weeks.length - 1], 6) };
}

/** Is this week one the sheet will show? */
export function withinWindow(date, today = todayISO()) {
  const { first, last } = planWindow(today);
  // ISO dates compare correctly as plain strings, which is the whole reason
  // dates are stored as 'YYYY-MM-DD' everywhere in this app.
  return date >= first && date <= last;
}

/**
 * Drop every day outside the window, in place.
 * @returns {boolean} whether anything was actually removed
 */
export function prunePlan(plan = {}, today = todayISO()) {
  let changed = false;
  for (const date of Object.keys(plan)) {
    if (withinWindow(date, today)) continue;
    delete plan[date];
    changed = true;
  }
  return changed;
}
