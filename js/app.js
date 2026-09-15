function appState() {
  return {
    page: 'track',  // 'track' | 'sync'
    version: window.APP_VERSION || '?',
    build: window.APP_BUILD || '?'
  };
}

window.appState = appState;
