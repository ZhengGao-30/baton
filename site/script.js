(function () {
  'use strict';

  // The Chinese text lives in index.html (so the page is complete without JavaScript).
  // English lives here, keyed by data-i18n / data-i18n-aria.
  var EN = {
    title: 'Baton · One window. Every account you own.',
    skip: 'Skip to content',
    brand_aria: 'Baton home',
    lang_btn: '中文',
    lang_aria: 'Switch to Chinese',
    nav_get: 'Get Baton',
    hero_title: 'One window.<br>Every account you own.',
    hero_sub: 'Baton lets the Claude Code window you already use hand heavy jobs to your other accounts.',
    cta_get: 'Get Baton',
    cta_how: 'See how it works',
    illus: 'Illustration',
    m_pill: 'Taking over · 1',
    m_leader: 'Leader',
    m_ready: 'Ready',
    m_running: 'Working now',
    m_5h: '5h',
    m_wk: 'Week',
    m_model: 'Model',
    m_limited: 'Limit reached · resets 14:20',
    hero_alt: 'Two interlocked matte rings, one terracotta and one cream, floating in front of a deep charcoal background.',
    sc_eyebrow: 'The panel',
    sc_h: 'Every account, in one panel.',
    sc_p: 'The leader, the workers, their usage and the jobs in progress, in one small panel in the system tray.',
    relay_alt: 'Three matte rings set out along a gentle curve; the terracotta one in the middle glides forward.',
    ledger_alt: 'Many thin cream rings stacked like growth rings or the edges of pages, one terracotta ring among them glowing faintly.',
    private_alt: 'A matte terracotta ring resting under a clear glass dome on a charcoal surface.',

    d1_title: 'Dispatch flow',
    d1_desc: 'You say “use baton” and the leader writes a complete brief. If a worker is free, it does the job, resuming the same session for that named thread and reading the project ledger, and the report comes back to the window. If every worker is at its limit, the reply is NO_WORKER_AVAILABLE and you are told; if a worker is already busy in that folder, the reply is BUSY and the job waits.',
    d1_n1: 'You say “use baton”',
    d1_n2a: 'Leader writes a brief',
    d1_n2b: 'complete and self-contained',
    d1_q: 'Is a worker free?',
    d1_no: 'no',
    d1_s1: 'You are told',
    d1_s2: 'Folder busy: wait',
    d1_yes: 'yes',
    d1_w1: 'A worker does the job',
    d1_w2: 'Same thread, same session',
    d1_w3: 'Ledger: what others did',
    d1_end: 'The report comes back',

    sn_eyebrow: 'Safety net',
    sn_h: 'When the window hits its limit, the work goes on.',
    sn_p1: 'If the leader’s account reaches its plan limit mid-task, Baton’s hook notices, and the next ready account continues the same session in the background.',
    sn_p2: 'You are told when it is done. If every account is limited, Baton waits for the earliest reset and carries on.',
    d3_title: 'Safety-net flow',
    d3_desc: 'The window’s account reaches its plan limit and Baton’s StopFailure hook notices. If another account is ready, it continues the same session in the background with --resume; if not, Baton waits for the earliest reset and then continues. Either way, you are told when it is done.',
    d3_n1: 'The window’s account hits its plan limit',
    d3_n2: 'Baton’s hook notices',
    d3_q: 'Is another account ready?',
    d3_yes: 'yes',
    d3_no: 'no',
    d3_y1: 'Same session continues',
    d3_y2: 'on the next ready account',
    d3_w1: 'Waits',
    d3_w2: 'until the',
    d3_w3: 'earliest reset',
    d3_end: 'You are told when it is done',

    d2_title: 'How Baton works',
    d2_desc: 'Your Claude Code window is the leader. It hands a job through baton_run to Baton, which runs on your computer at 127.0.0.1 with two hooks, the baton_run tool, the project ledger and named threads. Baton gives the job to a worker account and the report travels back to the window. Each worker runs the official Claude Code in its own login folder; its usage is read from /usage and it can have its own model. Sign-ins never leave each account’s folder.',
    d2_leader: 'Your Claude Code window · leader',
    d2_leader_s: 'Plans and talks to you',
    d2_report: 'report',
    d2_local: 'On your computer · 127.0.0.1',
    d2_hooks: 'Two hooks',
    d2_tool: 'baton_run tool',
    d2_ledger: 'Project ledger',
    d2_threads: 'Named threads',
    d2_job: 'job',
    d2_wa: 'Worker A',
    d2_wb: 'Worker B',
    d2_official: 'Official Claude Code',
    d2_folder: 'Own login folder',
    d2_lock: 'Sign-ins never leave each account’s folder.',
    d2_cap: 'Each worker’s usage is read from its own /usage, and each can have its own default model.',

    f1_eyebrow: 'Dispatch',
    f1_h: 'Say “/baton”. The heavy job goes to another account.',
    f1_p1: 'Say “use baton” in Claude Code, or type /baton with a job. A worker account runs the official Claude Code on its own usage.',
    f1_p2: 'When it finishes, it hands a report back to this window, and you carry on with the leader.',
    f2_eyebrow: 'Memory',
    f2_h: 'The same thread picks up where it left off.',
    f2_p1: 'Each line of work has a name. The same worker session is resumed, even if Baton moved it to another account when a limit was hit.',
    f2_p2: 'A project ledger records what every worker did, and the next worker reads it before starting.',
    v_threads: 'Threads',
    v_ledger: 'Ledger',

    f3_eyebrow: 'Usage at a glance',
    f3_h: 'Each account’s usage, at a glance.',
    f3_p1: 'The 5-hour and weekly usage of each account, read from Claude Code’s own /usage, with when each one resets.',
    f3_p2: 'Each account can have a default model, such as Haiku for light jobs.',
    v_reset_5h: 'resets 14:20',
    v_reset_wk: 'resets Mon 09:00',

    how_eyebrow: 'How it works',
    how_h: 'Three steps to start.',
    how_1_h: 'Add the accounts you own',
    how_1_p: 'Sign in to each account once. Baton keeps them apart from your usual Claude Code login.',
    how_2_h: 'Connect in one click',
    how_2_p: 'Click Connect. Baton adds two hooks, one tool and one skill to Claude Code, after backing up your settings.',
    how_3_h: 'Say “use baton” in Claude Code',
    how_3_p: 'Hand the heavy job to your worker accounts, and they report back when done.',

    pr_eyebrow: 'Principles',
    pr_h: 'Do less, and say so.',
    pr1_h: 'Sign-ins stay where they are',
    pr1_p: 'Sign-in always goes through Claude Code’s own flow, and each account’s tokens stay in that account’s folder. Baton never reads, copies or sends your Claude credentials.',
    pr2_h: 'Runs only on your computer',
    pr2_p: 'Baton runs on 127.0.0.1 and sends nothing anywhere. It does not proxy API traffic or modify the Claude Code program.',
    pr3_h: 'One click to undo',
    pr3_p: 'Disconnecting restores your Claude settings. Saved sign-ins are kept unless you choose to delete them.',
    pr4_h: 'Open about limits',
    pr4_p: 'The next section spells out the limits.',

    gk_eyebrow: 'Good to know',
    gk_h: 'Who it is for, and where the limits are.',
    gk1: 'Baton is for people who legitimately hold several accounts of their own, such as a personal and a work account.',
    gk2: 'Every worker runs the official Claude Code under its own login. Baton does not pool or share one login’s usage.',
    gk3: 'Each account’s usage limits and terms still apply: the <a href="https://www.anthropic.com/legal/consumer-terms">Consumer Terms</a> and <a href="https://www.anthropic.com/legal/aup">Usage Policy</a>, and your organisation’s terms if an account is a Team or Enterprise seat.',
    gk4: 'Windows first.',
    gk5: 'A real plan-limit event has not yet happened in the desktop app’s Code tab; the failover path is tested with simulated events.',

    get_eyebrow: 'Get',
    get_h: 'Windows · version 0.1, early',
    get_p: 'Download the installer and run it. You can also read the source.',
    get_win: 'Download for Windows',
    get_portable: 'Portable version',
    get_source: 'View source on GitHub',
    get_n1: 'For Windows (so far tested on Windows 11 only), with Claude Code already installed (the desktop app or the CLI).',
    get_n2: 'The installer is not code-signed yet, so Windows SmartScreen may show “unknown publisher”. Click More info, then Run anyway.',
    get_n3: 'Baton is open source (MIT licence), so you can read every line.',
    get_n4: 'This is early version 0.1.',
    get_build_h: 'Build it yourself',
    get_note: 'From the project folder, run:',

    nav_film: 'Watch the film',
    film_h: 'Baton in 48 seconds.',
    film_p: 'A short film: one window, several accounts you own, and how the heavy work is handed off.',
    film_aria: 'Baton, a 48-second film',
    film_fallback: 'Cannot play the video? Download the film (MP4)',

    meta_desc: 'Baton lets the Claude Code window you already use hand heavy jobs to your other accounts.',
    og_title: 'Baton · One window. Every account you own.',
    og_image_alt: 'Baton film title card: “One window. Every account you own.” with the Baton wordmark, on a dark background.',

    foot: 'Baton is an independent tool. It is not made by or affiliated with Anthropic; it works with Claude Code.'
  };

  var KEY = 'baton-site-lang';
  var root = document.documentElement;
  var toggle = document.getElementById('lang-toggle');
  var textNodes = document.querySelectorAll('[data-i18n]');
  var ariaNodes = document.querySelectorAll('[data-i18n-aria]');
  var altNodes = document.querySelectorAll('[data-i18n-alt]');
  var contentNodes = document.querySelectorAll('[data-i18n-content]');

  // Keep the Chinese from the HTML so we can switch back without a reload.
  var zhText = new Map();
  var zhAria = new Map();
  textNodes.forEach(function (n) { zhText.set(n, n.innerHTML); });
  ariaNodes.forEach(function (n) { zhAria.set(n, n.getAttribute('aria-label')); });
  var zhAlt = new Map();
  altNodes.forEach(function (n) { zhAlt.set(n, n.getAttribute('alt')); });
  var zhContent = new Map();
  contentNodes.forEach(function (n) { zhContent.set(n, n.getAttribute('content')); });

  var current = 'zh';

  function readSaved() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function saveChoice(lang) {
    try { localStorage.setItem(KEY, lang); } catch (e) { /* private mode or storage disabled: the choice just is not remembered */ }
  }

  function apply(lang) {
    var isEn = lang === 'en';
    textNodes.forEach(function (n) {
      var key = n.getAttribute('data-i18n');
      n.innerHTML = isEn && EN[key] !== undefined ? EN[key] : zhText.get(n);
    });
    ariaNodes.forEach(function (n) {
      var key = n.getAttribute('data-i18n-aria');
      n.setAttribute('aria-label', isEn && EN[key] !== undefined ? EN[key] : zhAria.get(n));
    });
    altNodes.forEach(function (n) {
      var key = n.getAttribute('data-i18n-alt');
      n.setAttribute('alt', isEn && EN[key] !== undefined ? EN[key] : zhAlt.get(n));
    });
    contentNodes.forEach(function (n) {
      var key = n.getAttribute('data-i18n-content');
      n.setAttribute('content', isEn && EN[key] !== undefined ? EN[key] : zhContent.get(n));
    });
    root.lang = isEn ? 'en' : 'zh-CN';
    current = isEn ? 'en' : 'zh';
  }

  // The site opens in Chinese for everyone. Only a choice the visitor made themselves (the language button) is
  // remembered and wins; the browser's language is deliberately not used.
  var saved = readSaved();
  var initial = saved === 'en' || saved === 'zh' ? saved : 'zh';
  apply(initial);

  toggle.addEventListener('click', function () {
    var next = current === 'zh' ? 'en' : 'zh';
    apply(next);
    saveChoice(next);
  });

  // The one place the GitHub repo is named in JavaScript. index.html has the same links as static hrefs,
  // so the download buttons still work without JavaScript. data-repo-path is the part after REPO.
  var REPO = 'https://github.com/zhenggao-30/baton';
  document.querySelectorAll('[data-repo-path]').forEach(function (a) {
    a.setAttribute('href', REPO + a.getAttribute('data-repo-path'));
  });

  // The film never autoplays; pause it once it has scrolled out of view. Without IntersectionObserver it keeps its controls.
  var film = document.querySelector('.film-card video');
  if (film && 'IntersectionObserver' in window) {
    var filmIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting && !film.paused) film.pause();
      });
    });
    filmIO.observe(film);
  }

  // Reveal on scroll, and draw the diagrams' accent paths the first time they come into view.
  // The inline script in <head> sets .js only when IntersectionObserver exists and motion is allowed;
  // CSS hides nothing without it.
  var watched = document.querySelectorAll('.reveal, .diagram');
  if (!root.classList.contains('js')) {
    watched.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' });
    watched.forEach(function (el) { io.observe(el); });
  }
})();
