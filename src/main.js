'use strict';
// Electron shell: a small window that lives in the tray. It has to keep running when closed,
// because the Claude Code hook can only reach a Baton that is alive.

const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, nativeTheme, shell, powerSaveBlocker } = require('electron');
const os = require('os');
const path = require('path');
const { createServer } = require('./server');
const { createIntroGate } = require('./intro');
const store = require('./core/store');

// The language is a setting (English by default), read whenever a string is needed so a change applies at once.
const isZh = () => store.loadSettings().language === 'zh';
const txt = () => (isZh()
  ? { open: '打开 Baton', quit: '退出 Baton', tip: 'Baton · 守着 Claude Code', tipBusy: (n) => `Baton · 接管中 (${n})` }
  : { open: 'Open Baton', quit: 'Quit Baton', tip: 'Baton · watching Claude Code', tipBusy: (n) => `Baton · taking over (${n})` });

// Names the app for Windows before it is ready, so the taskbar groups and icons it as Baton, not as Electron.
app.setAppUserModelId('dev.baton.app');

const MSG = {
  start: (n) => (isZh() ? [`${n.job.project}`, `${n.origin ? `${n.origin} 额度用完，` : ''}正在其他账号上继续`] : [n.job.project, `${n.origin ? `${n.origin} hit its limit. ` : ''}Continuing on another account`]),
  switch: (n, label) => (isZh() ? [n.job.project, `已交给 ${label(n.to)}`] : [n.job.project, `Passed on to ${label(n.to)}`]),
  done: (n) => (isZh() ? [n.job.project, '已完成，回到原窗口即可查看'] : [n.job.project, 'Finished. Open the session as usual to see the result']),
  failed: (n) => (isZh() ? [n.job.project, '未能完成'] : [n.job.project, 'Could not be finished']),
  leader: (n, label) => (isZh() ? ['领队已切换', n.to ? `现在窗口用的是 ${label(n.to)}` : `现在窗口用的是号池外的账号 ${n.outside}`] : ['Leader changed', n.to ? `This window now uses ${label(n.to)}` : `This window now uses ${n.outside}, which is not in the pool`]),
  'needs-login': (n, label) => (isZh() ? ['需要重新登录', label(n.account)] : ['Sign-in needed', label(n.account)]),
};

// Baton must keep watching for Claude Code from the tray: a stray error is logged, not turned into Electron's
// "A JavaScript error occurred in the main process" dialog (which also leaves the app in an unknown state).
process.on('uncaughtException', (e) => console.error('[baton] uncaught exception (kept running):', (e && e.stack) || e));
process.on('unhandledRejection', (e) => console.error('[baton] unhandled rejection (kept running):', (e && e.stack) || e));

// `--disconnect` (run by the uninstaller): take Baton out of Claude Code, print one line, leave. It runs before the
// single-instance lock and before any window, so it works while Baton is running and never shows anything.
if (process.argv.includes('--disconnect')) {
  const say = (line) => process.stdout.write(line + String.fromCharCode(10));
  require('./cli-disconnect').disconnect()
    .then(say)
    .catch((e) => say(`Baton disconnect: could not finish (${(e && e.message) || e}).`))
    .finally(() => app.exit(0));
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let tray = null;
  let server = null;
  let quitting = false;
  let blocker = null;

  let busyCount = 0;

  const asset = (f) => path.join(__dirname, '..', 'build', f);
  const windowIcon = () => asset(process.platform === 'win32' ? 'icon.ico' : 'icon.png');

  const setTooltip = () => tray?.setToolTip(busyCount ? txt().tipBusy(busyCount) : txt().tip);
  function buildMenu() {
    tray?.setContextMenu(Menu.buildFromTemplate([
      { label: txt().open, click: showWindow },
      { type: 'separator' },
      { label: txt().quit, click: () => { quitting = true; app.quit(); } },
    ]));
  }

  function showWindow() {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    const reveal = () => { win.show(); win.focus(); };
    // started hidden: the first time the window is opened plays the intro (the page draws its splash, then we show it)
    if (intro.onShow()) win.webContents.executeJavaScript('window.batonIntro && window.batonIntro()').catch(() => {}).finally(reveal);
    else reveal();
    server?.refreshUsage({ maxAgeMs: 15000 }); // opening the panel shows fresh numbers, not the ones from when it was hidden
  }

  // Windows 11 22H2+ (build 22621) can draw Mica behind the page; anywhere else the window gets a solid colour.
  const micaSupported = process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621;
  const theme = () => (nativeTheme.shouldUseDarkColors
    ? { bg: '#1f1e1d', symbols: '#f5f4ee' }
    : { bg: '#f5f4f0', symbols: '#1a1a19' });
  const intro = createIntroGate();
  const INK = '#1f1e1d'; // the intro's splash colour: the window starts in it so nothing flashes white
  const overlay = () => ({ color: '#00000000', symbolColor: theme().symbols, height: 36 });

  function createWindow(hidden) {
    let mica = false;
    const playIntro = intro.onLoad(!hidden);
    const opts = {
      width: 420, height: 680, minWidth: 380, minHeight: 520, title: 'Baton', show: false, // shown on ready-to-show
      autoHideMenuBar: true, backgroundColor: playIntro ? INK : theme().bg, icon: windowIcon(),
      titleBarStyle: 'hidden', titleBarOverlay: overlay(), // the page draws the title bar, Windows keeps its own buttons
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    };
    if (micaSupported) {
      try {
        win = new BrowserWindow({ ...opts, backgroundColor: '#00000000', backgroundMaterial: 'mica' });
        mica = true;
      } catch { win = null; }
    }
    if (!win) win = new BrowserWindow(opts);
    win.setIcon(windowIcon());
    // The page lets the material show through only when it is really there (#m=1 survives the token redirect).
    const flags = [mica && 'm=1', playIntro && 'boot=1'].filter(Boolean).join('&');
    win.loadURL(`${server.url}${flags ? `#${flags}` : ''}`);
    win.once('ready-to-show', () => {
      if (!hidden) { win.show(); win.focus(); }
      if (playIntro && !mica) setTimeout(() => { if (!win.isDestroyed()) win.setBackgroundColor(theme().bg); }, 2500);
    });
    if (mica) win.webContents.on('dom-ready', () => { win.webContents.executeJavaScript("document.documentElement.dataset.material = 'mica'").catch(() => {}); });
    nativeTheme.on('updated', () => {
      if (!win || win.isDestroyed()) return;
      try { win.setTitleBarOverlay(overlay()); } catch { /* not supported here */ }
      if (!mica) win.setBackgroundColor(theme().bg);
    });
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith(server.origin)) { e.preventDefault(); shell.openExternal(url); }
    });
    win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  }

  function updateBusy(jobs) {
    const n = jobs.active.length;
    busyCount = n;
    setTooltip();
    if (n && blocker == null) blocker = powerSaveBlocker.start('prevent-app-suspension'); // do not sleep mid-task
    if (!n && blocker != null) { powerSaveBlocker.stop(blocker); blocker = null; }
  }

  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const label = (name, accounts) => accounts.find((a) => a.name === name)?.label || name;

    server = await createServer({
      shell: {
        isPanelVisible: () => !!win && win.isVisible() && !win.isMinimized(), // usage is read live only while someone is looking
        // Run from source ("electron ."), the login item must name the app folder too, or Windows would start
        // a bare Electron (its default welcome window) at sign-in instead of Baton.
        setAutoStart: (on) => app.setLoginItemSettings({ openAtLogin: !!on, args: app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'] }),
        quit: () => { quitting = true; app.quit(); },
        onLanguage: () => { buildMenu(); setTooltip(); },
        notify: (n, accounts) => {
          const make = MSG[n.kind];
          if (!make || !Notification.isSupported()) return;
          const [title, body] = make({ ...n, origin: n.origin ? label(n.origin, accounts) : '' }, (x) => label(x, accounts));
          const note = new Notification({ title, body, icon: asset('icon.png'), silent: n.kind === 'switch' });
          note.on('click', showWindow);
          note.show();
        },
      },
    });
    server.takeovers.on('update', updateBusy);

    tray = new Tray(nativeImage.createFromPath(asset('tray.png')).resize({ width: 16, height: 16 }));
    setTooltip();
    buildMenu();
    tray.on('click', showWindow);

    createWindow(process.argv.includes('--hidden') && store.loadSettings().startAtLogin);
  });

  // Closing the window must not quit: Baton keeps watching from the tray.
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => { quitting = true; });
}
