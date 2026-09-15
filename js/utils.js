// Small date/number helpers shared by weight.js and sync.js.

function todayStr() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

// Round to 1 decimal place, avoiding classic 0.1+0.1 float drift.
function round1(n) {
  return Math.round((Number(n) + Number.EPSILON) * 10) / 10;
}

// day-of-week for a YYYY-MM-DD string, Monday=1..Sunday=7 (ISO), computed
// without a Date-timezone round-trip so it's stable regardless of locale.
function isoWeekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  return dow === 0 ? 7 : dow;
}

// The Monday (YYYY-MM-DD) of the ISO week containing dateStr.
function weekStart(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - (isoWeekday(dateStr) - 1));
  return dt.toISOString().slice(0, 10);
}

// Short display label for a YYYY-MM-DD string, e.g. "Sep 15".
function shortLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

window.todayStr = todayStr;
window.round1 = round1;
window.isoWeekday = isoWeekday;
window.weekStart = weekStart;
window.shortLabel = shortLabel;
