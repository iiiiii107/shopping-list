/* Keeping the screen on while you shop.

   A phone that sleeps every thirty seconds is unusable with a trolley in one
   hand, which is the same reason the cook book holds the screen awake over a
   long simmer.

   Two things the API does not do for you. The lock is dropped whenever the
   page is hidden — switching apps, locking the phone — so it has to be taken
   again on the way back, or the screen sleeps for the rest of the shop. And
   it simply does not exist on some browsers, iOS Safari before 16.4 among
   them; that is not an error worth showing anyone, so it fails quietly and
   the list still works. */

export function keepAwake() {
  if (!('wakeLock' in navigator)) return () => {};

  let sentinel = null;
  let done = false;

  async function take() {
    if (done || document.visibilityState !== 'visible') return;
    try {
      sentinel = await navigator.wakeLock.request('screen');
      // A lock released by the system, rather than by us, leaves a stale
      // handle behind; dropping it here keeps `release` honest.
      sentinel.addEventListener('release', () => { sentinel = null; });
    } catch {
      // Denied, or the tab lost focus mid-request. Not worth a word.
    }
  }

  const onVisible = () => { if (document.visibilityState === 'visible') take(); };
  document.addEventListener('visibilitychange', onVisible);
  take();

  return () => {
    done = true;
    document.removeEventListener('visibilitychange', onVisible);
    sentinel?.release?.().catch(() => {});
    sentinel = null;
  };
}
