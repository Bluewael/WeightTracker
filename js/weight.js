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
      } else {
        this.weightKg = DEFAULT_KG;
        this.hasExisting = false;
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
    // week's logged entries.
    // Every Monday: only entries that were actually logged on a Monday.
    get chartSeries() {
      if (this.chartMode === 'monday') {
        return this.entries
          .filter(e => isoWeekday(e.date) === 1)
          .map(e => ({ label: shortLabel(e.date), value: e.weightKg }));
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
            label: shortLabel(key),
            value: round1(vals.reduce((s, v) => s + v, 0) / vals.length)
          }));
      }
      return this.entries.map(e => ({ label: shortLabel(e.date), value: e.weightKg }));
    },

    renderChart() {
      const canvas = document.getElementById('weightChart');
      if (!canvas) return;
      const series = this.chartSeries;
      const labels = series.map(p => p.label);
      const data = series.map(p => p.value);

      if (weightChart) {
        weightChart.data.labels = labels;
        weightChart.data.datasets[0].data = data;
        weightChart.update();
        return;
      }
      if (!series.length) return;
      weightChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Weight (kg)',
            data,
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
            tooltip: { callbacks: { label: ctx => `${ctx.parsed.y.toFixed(1)} kg` } }
          },
          scales: {
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
