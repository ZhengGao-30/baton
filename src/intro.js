'use strict';
// When the launch intro plays: once per process, the first time the window is really seen. Shown at start-up,
// it plays with the first page load; started hidden (autostart, --hidden), it waits for the first time the
// window is opened. Re-showing from the tray, a language change or a reload never plays it again.
function createIntroGate() {
  let played = false;
  return {
    onLoad(shownAtStart) {
      if (played || !shownAtStart) return false;
      played = true;
      return true;
    },
    onShow() {
      if (played) return false;
      played = true;
      return true;
    },
  };
}

module.exports = { createIntroGate };
