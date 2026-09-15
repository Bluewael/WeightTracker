// IndexedDB schema via Dexie
// weights: { date (YYYY-MM-DD, primary key — one entry per day), weightKg, updatedAt }
// Using `date` as the primary key makes "edit today's entry if it exists" a
// plain put() — no separate lookup-then-insert-or-update dance.

const db = new Dexie('weighttracker');
db.version(1).stores({
  weights: 'date, updatedAt'
});

window.db = db;

// Broadcast a `data-changed` event on any write so the chart and sync module
// can react without polling. Coalesced via microtask so a bulk import (e.g.
// Drive hydration) dispatches once, not once per row.
(function setupChangeBroadcast() {
  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      window.dispatchEvent(new CustomEvent('data-changed'));
    });
  }
  const table = db.table('weights');
  table.hook('creating', schedule);
  table.hook('updating', schedule);
  table.hook('deleting', schedule);
})();
