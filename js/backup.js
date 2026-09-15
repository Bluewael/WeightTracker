// Manual JSON export/import — a safety net independent of Google Drive sync
// (protects data even if sync was never configured, or browser storage gets
// cleared). Uses the same payload shape as sync.js so a downloaded file can
// also be inspected/edited by hand if needed.

function backupPage() {
  return {
    lastExport: '',
    importMsg: '',
    importErr: false,

    async exportData() {
      const payload = await gBuildSyncPayload();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `weighttracker-backup-${todayStr()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.lastExport = new Date().toLocaleString();
    },

    async importData(file) {
      this.importMsg = '';
      this.importErr = false;
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!Array.isArray(data.weights)) throw new Error('Not a weight tracker backup file.');
        await gHydrateFromPayload(data);
        window.dispatchEvent(new CustomEvent('data-changed'));
        this.importMsg = `Imported ${data.weights.length} entries.`;
      } catch (err) {
        this.importErr = true;
        this.importMsg = 'Import failed: ' + (err.message || err);
      }
    },

    async resetAll() {
      if (!confirm('Delete ALL local weight entries? This cannot be undone (unless you have a backup or Drive sync).')) return;
      await db.weights.clear();
      this.importMsg = 'All local data cleared.';
      this.importErr = false;
    }
  };
}

window.backupPage = backupPage;
