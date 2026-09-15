// Entry form + trend chart. Kept as a single Alpine component since both
// halves share the same `entries` data and the entry form needs to trigger a
// chart refresh on save.

const MIN_KG = 20;
const MAX_KG = 300;
const DEFAULT_KG = 80;

// Chart.js instance kept outside Alpine — Alpine's Proxy wrapping breaks
// Chart.js's internal `this.scales` reads/writes (same lesson as trends.js
// in the sibling budget app).
let weightChart = null;

function weightPage() {
  return {
    date: todayStr(),
    weightKg: DEFAULT_KG,
    hasExisting: false,
    carriedFromDate: null,  // date the current (unsaved) weightKg was carried forward from, if any
    savedFlash: false,
    entries: [],           // all rows from db.weights, sorted by date
    chartMode: 'day',       // 'day' | 'week-avg' | 'monday'

    async init() {
      await this.loadEntryForDate();
      await this.refreshEntries();
      window.addEventListener('data-changed', () => this.refreshEntries());
      this.$watch('chartMode', () => this.$nextTick(() => this.renderChart()));
    },

    async onDateChange(value) {
      this.date = value;
      await this.loadEntryForDate();
    },

    async loadEntryForDate() {
      const row = await db.weights.get(this.date);
      if (row) {
        this.weightKg = row.weightKg;
        this.hasExisting = true;
        this.carriedFromDate = null;
        return;
      }
      this.hasExisting = false;
      // No entry for this date — carry forward the closest prior entry (e.g.
      // "yesterday's weight") rather than always resetting to the default.
      const prior = await db.weights.where('date').below(this.date).last();
      if (prior) {
        this.weightKg = prior.weightKg;
        this.carriedFromDate = prior.date;
      } else {
        this.weightKg = DEFAULT_KG;
        this.carriedFromDate = null;
      }
    },

    adjust(delta) {
      this.weightKg = clamp(round1((this.weightKg || 0) + delta));
    },

    onBlurWeight() {
      this.weightKg = clamp(round1(this.weightKg || 0));
    },

    async accept() {
      const weightKg = clamp(round1(this.weightKg || 0));
      this.weightKg = weightKg;
      await db.weights.put({ date: this.date, weightKg, updatedAt: Date.now() });
      this.hasExisting = true;
      this.savedFlash = true;
      setTimeout(() => { this.savedFlash = false; }, 1200);
    },

    async refreshEntries() {
      this.entries = await db.weights.orderBy('date').toArray();
      // Local edit already reflects the row we just saved; a remote hydration
      // (Drive sync) may have changed the entry under the currently-selected
      // date too, so re-sync the form from the DB.
      await this.loadEntryForDate();
      this.$nextTick(() => this.renderChart());
    },

    // Per-day: raw points, one per logged day.
    // Average per week: one point per ISO week (Mon–Sun), averaging that
    // week's logged entries, plotted at that week's Monday.
    // Every Monday: only entries that were actually logged on a Monday.
    // Each point carries an {x, y} pair (x = ISO date string) so the chart's
    // time scale can space points by actual elapsed time rather than by
    // logged-entry order — a 6-week gap in logging should look like a gap,
    // not the same width as two consecutive days.
    get chartSeries() {
      if (this.chartMode === 'monday') {
        return this.entries
          .filter(e => isoWeekday(e.date) === 1)
          .map(e => ({ x: e.date, y: e.weightKg }));
      }
      if (this.chartMode === 'week-avg') {
        const byWeek = new Map();
        for (const e of this.entries) {
          const key = weekStart(e.date);
          if (!byWeek.has(key)) byWeek.set(key, []);
          byWeek.get(key).push(e.weightKg);
        }
        return [...byWeek.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([key, vals]) => ({
            x: key,
            y: round1(vals.reduce((s, v) => s + v, 0) / vals.length)
          }));
      }
      return this.entries.map(e => ({ x: e.date, y: e.weightKg }));
    },

    renderChart() {
      const canvas = document.getElementById('weightChart');
      if (!canvas) return;
      const series = this.chartSeries;

      if (weightChart) {
        weightChart.data.datasets[0].data = series;
        weightChart.update();
        return;
      }
      if (!series.length) return;
      weightChart = new Chart(canvas, {
        type: 'line',
        data: {
          datasets: [{
            label: 'Weight (kg)',
            data: series,
            borderColor: '#3b82f6',
            backgroundColor: '#3b82f6',
            pointRadius: 3,
            tension: 0.2,
            spanGaps: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: ctx => shortLabel(ctx[0].raw.x),
                label: ctx => `${ctx.parsed.y.toFixed(1)} kg`
              }
            }
          },
          scales: {
            x: {
              type: 'time',
              time: { unit: 'day', tooltipFormat: 'MMM d, yyyy' },
              ticks: { autoSkip: true, maxRotation: 0 }
            },
            y: { ticks: { callback: v => `${Number(v).toFixed(1)} kg` } }
          }
        }
      });
    }
  };
}

function clamp(n) {
  return Math.min(MAX_KG, Math.max(MIN_KG, n));
}

window.weightPage = weightPage;
