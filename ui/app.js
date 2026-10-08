'use strict';
// Baton's panel. The page is drawn by small render functions into three fixed regions (title bar, main view,
// settings page) and patched in place by morph(), so focus, scroll and open menus survive every update.
// Inside those regions, buttons carry data-act (handled by one delegated listener) instead of their own listeners.

/* ---------- i18n ---------- */
const T = {
  en: {
    app: 'Baton', tabs: 'Sections', tab_overview: 'Overview', tab_accounts: 'Accounts',
    watching: 'Watching', working_n: (n) => `Working · ${n}`, needs_setup: 'Setup needed',
    settings: 'Settings', open_settings: 'Open settings', back: 'Back',
    // overview
    this_window: 'This window', leader_tag: 'Leader', not_in_pool: 'Not in the pool',
    leader_outside: 'Not needed for Baton to work. Add it only to see its usage here.', add_this: 'Add it',
    leader_pending: 'Start a new session in the Claude app and Baton will recognise which account this window uses.',
    activity: 'Activity', recent: 'Recent', idle: 'Nothing running. Keep working in Claude as usual.',
    stop: 'Stop', starting: 'Starting…', continuing_on: (x) => `Continuing on ${x}`, takeover_tag: 'Takeover',
    waiting_until: (x) => `All accounts are recharging · continues ${x} ·`,
    finished: 'Finished', failed: 'Could not finish', stopped: 'Stopped',
    v_read: (x) => `Reading ${x}`, v_edit: (x) => `Editing ${x}`, v_write: (x) => `Writing ${x}`, v_run: (x) => `Running ${x}`,
    v_search: (x) => `Searching ${x}`, v_find: (x) => `Finding ${x}`, v_list: (x) => `Listing ${x}`, v_fetch: (x) => `Fetching ${x}`,
    v_web: (x) => `Searching the web for ${x}`, v_plan: () => 'Updating the plan', v_agent: (x) => `Delegating ${x}`, v_use: (x) => `Using ${x}`,
    // setup
    get_started: 'Get started', setup_progress: (n) => `${n} of 3 done`,
    s1: 'Add the Claude accounts you own', s1_sub: 'Sign in to each one once. Baton keeps them separate from your main Claude Code login.',
    s1_cli_missing: 'No sign-in found in the command-line Claude Code. The Claude desktop app keeps its own sign-in inside the app, which Baton cannot read: add your other accounts here.',
    s2: 'Which account is this Claude window signed in to?',
    s2_known: (e) => `This window is signed in as ${e}.`,
    s2_known_pool: 'It is in the pool and acts as the leader.', s2_known_outside: 'It does not need to be added: it plans and talks to you while your other accounts do the heavy work.',
    s2_pending: 'Claude desktop app found. Connect below, then start a new session in the app: Baton recognises the account by itself.',
    s2_none: 'No Claude desktop app sign-in found yet. After you connect and start a session, Baton recognises the account by itself.',
    s3: 'Connect to Claude Code', s3_sub: 'Adds two hooks, one tool and one skill to Claude Code (your settings are backed up first). Settings › Remove Baton undoes all of it.',
    connect: 'Connect', start_login: 'Start Baton when I sign in to Windows',
    use_current: 'Use my current login', add_account: 'Add account',
    // accounts
    accounts: 'Accounts', refresh_usage: 'Refresh usage', more_actions: (x) => `More actions for ${x}`,
    ready: 'Ready', working: 'Working now', limited: 'Limited', back_in_pre: 'back in ', back_in_post: '',
    signin_needed: 'Sign-in needed', sign_in: 'Sign in',
    set_leader: 'Set as this window’s account', signin_again: 'Sign in again', remove: 'Remove',
    confirm_remove_title: 'Remove this account?', confirm_remove: (x) => `${x} will be removed and its saved sign-in on this computer deleted.`,
    usage_5h: '5h', usage_wk: 'Week', resets_at: (x) => `resets ${x}`,
    usage_reading: 'Reading usage…', usage_unavailable: 'Usage not available yet', usage_updating: 'Updating…',
    updated_pre: 'Updated ', updated_post: '', age_now: 'just now', age_s: (s) => `${s}s ago`, age_m: (m) => `${m} min ago`, age_h: (h) => `${h} h ago`, age_d: (d) => (d === 1 ? 'yesterday' : `${d} days ago`),
    model_aria: (x) => `Model: ${x}. Change`, model_tip: 'The model this account uses when Baton runs work on it. A model named in a request wins over this.',
    model_default: 'Account default', model_haiku: 'Haiku', model_sonnet: 'Sonnet', model_opus: 'Opus', model_custom: 'Other…',
    model_haiku_d: 'Light, saves usage', model_sonnet_d: 'Balanced', model_opus_d: 'Strongest',
    model_custom_title: 'Choose a model', model_custom_sub: 'An alias (haiku, sonnet, opus) or a full model id such as claude-haiku-5-5. Leave empty for the account default.',
    model_label: 'Model',
    // settings
    set_lang: 'Language', set_perm: 'While taking over, Claude may',
    perm_acceptEdits: 'Edit files', perm_acceptEdits_d: 'Changes files in the project. Shell commands are not run.',
    perm_bypassPermissions: 'Do everything', perm_bypassPermissions_d: 'Also runs commands without asking. Only if you trust the projects.',
    perm_plan: 'Read only', perm_plan_d: 'Reads and plans, changes nothing.',
    set_startup: 'Start with Windows', set_startup_d: 'Baton waits quietly in the tray.',
    set_conn: 'Connection', connected: 'Connected to Claude Code', not_connected: 'Not connected', disconnect: 'Disconnect',
    about: 'About', about_text: 'Baton is an independent tool, not affiliated with Anthropic.', replay_intro: 'Replay intro',
    danger: 'Danger zone', remove_all: 'Remove Baton…', remove_all_d: 'Take Baton out of Claude Code and restore your settings.',
    remove_all_title: 'Remove Baton?',
    remove_all_confirm: 'Its hooks, tool and skill are removed and your own Claude Code settings go back to how they were. Your saved account sign-ins are kept unless you tick the box below.',
    remove_logins: 'Also delete the saved account sign-ins (you would have to sign in to each account again)',
    removed_done: 'Baton was removed. You can close and uninstall the app now.',
    removed_kept: 'Baton was removed from Claude Code. Your account sign-ins are still saved, so setting Baton up again will not ask you to sign in.',
    // dialogs
    email: 'Email', email_hint: 'Used to pre-fill the sign-in page. Optional.', cancel: 'Cancel', continue: 'Continue', close: 'Close', save: 'Save',
    add_title: 'Add an account', add_sub: 'A browser window opens just for this account.',
    login_title: 'Finish signing in', login_waiting: (x) => `A browser window opened for ${x}. Sign in there and this continues by itself.`,
    login_starting: 'Starting…', login_tip: 'If that browser is already signed in to a different Claude account, open the link in a private window instead.',
    open_again: 'Open again', copy_link: 'Copy link', copied: 'Link copied',
    code_title: 'Paste the code', code_sub: 'The browser page shows a code after you sign in. Paste it here.', code_label: 'Code', submit: 'Submit',
    login_done: 'Signed in', login_failed: 'Sign-in did not finish', try_again: 'Try again',
    no_claude: 'Claude Code was not found on this computer.', get_claude: 'Install Claude Code',
    request_failed: (n) => `Request failed (${n})`, unreachable: (m) => `Could not reach Baton: ${m}`,
    n_leader: (p) => `Leader changed: this window now uses ${p.to || p.outside}`,
    n_done: (p) => `“${p.job.project}” finished on ${p.job.account || 'another account'}`,
    n_failed: (p) => `“${p.job.project}” could not be finished`, n_needs_login: (p) => `${p.account} needs to sign in again`,
  },
  zh: {
    app: 'Baton', tabs: '分区', tab_overview: '概览', tab_accounts: '账号',
    watching: '守候中', working_n: (n) => `工作中 · ${n}`, needs_setup: '需要设置',
    settings: '设置', open_settings: '打开设置', back: '返回',
    this_window: '本窗口', leader_tag: '领队', not_in_pool: '不在号池',
    leader_outside: 'Baton 不需要它也能工作。想在这里看它的额度时再加入号池。', add_this: '加入号池',
    leader_pending: '在 Claude App 里新开一个会话，Baton 就会认出这个窗口用的是哪个账号。',
    activity: '动态', recent: '最近', idle: '暂时没有任务，照常在 Claude 里工作就行。',
    stop: '停止', starting: '正在启动…', continuing_on: (x) => `正在 ${x} 上继续`, takeover_tag: '接管',
    waiting_until: (x) => `所有账号都在恢复额度 · ${x} 自动继续 ·`,
    finished: '已完成', failed: '未能完成', stopped: '已停止',
    v_read: (x) => `正在读取 ${x}`, v_edit: (x) => `正在编辑 ${x}`, v_write: (x) => `正在写入 ${x}`, v_run: (x) => `正在运行 ${x}`,
    v_search: (x) => `正在搜索 ${x}`, v_find: (x) => `正在查找 ${x}`, v_list: (x) => `正在列出 ${x}`, v_fetch: (x) => `正在获取 ${x}`,
    v_web: (x) => `正在网上搜索 ${x}`, v_plan: () => '正在更新计划', v_agent: (x) => `正在委派 ${x}`, v_use: (x) => `正在使用 ${x}`,
    get_started: '开始设置', setup_progress: (n) => `已完成 ${n}/3`,
    s1: '添加你拥有的 Claude 账号', s1_sub: '每个账号登录一次即可，和你平时的 Claude Code 登录互不干扰。',
    s1_cli_missing: '命令行版 Claude Code 里没有登录。Claude 桌面 App 的登录保存在 App 内部，Baton 读不到也不会去读：请在这里添加你的其他账号。',
    s2: '这个 Claude 窗口登录的是哪个账号？',
    s2_known: (e) => `这个窗口登录的是 ${e}。`,
    s2_known_pool: '它在号池里，作为领队使用。', s2_known_outside: '不需要添加：它负责规划并和你对话，重活交给你的其他账号。',
    s2_pending: '已检测到 Claude 桌面 App 的登录。先在下面点“连接”，然后在 App 里新开一个会话，Baton 会自动认出是哪个账号。',
    s2_none: '暂未发现 Claude 桌面 App 的登录。连接之后开始一个会话，Baton 会自动认出账号。',
    s3: '连接 Claude Code', s3_sub: '给 Claude Code 加两条钩子、一个工具和一个技能（会先备份你的设置）。在 设置 › 移除 Baton 里可全部撤销。',
    connect: '连接', start_login: '登录 Windows 时自动启动 Baton',
    use_current: '使用当前登录', add_account: '添加账号',
    accounts: '账号', refresh_usage: '刷新额度', more_actions: (x) => `${x} 的更多操作`,
    ready: '就绪', working: '正在工作', limited: '额度用完', back_in_pre: '', back_in_post: ' 后恢复',
    signin_needed: '需要重新登录', sign_in: '登录',
    set_leader: '设为本窗口的账号', signin_again: '重新登录', remove: '移除',
    confirm_remove_title: '移除这个账号？', confirm_remove: (x) => `将移除 ${x}，并删除本机上保存的登录信息。`,
    usage_5h: '5小时', usage_wk: '本周', resets_at: (x) => `${x} 恢复`,
    usage_reading: '读取额度中…', usage_unavailable: '额度暂时读不到', usage_updating: '更新中…',
    updated_pre: '', updated_post: '更新', age_now: '刚刚', age_s: (s) => `${s} 秒前`, age_m: (m) => `${m} 分钟前`, age_h: (h) => `${h} 小时前`, age_d: (d) => (d === 1 ? '昨天' : `${d} 天前`),
    model_aria: (x) => `模型：${x}。点击更改`, model_tip: 'Baton 在这个账号上干活时用的模型。请求里单独指定了模型时，以请求为准。',
    model_default: '账号默认', model_haiku: 'Haiku', model_sonnet: 'Sonnet', model_opus: 'Opus', model_custom: '其他…',
    model_haiku_d: '轻量，省额度', model_sonnet_d: '均衡', model_opus_d: '最强',
    model_custom_title: '选择模型', model_custom_sub: '填别名（haiku、sonnet、opus）或完整模型 ID，比如 claude-haiku-5-5。留空表示账号默认。',
    model_label: '模型',
    set_lang: '语言', set_perm: '接管期间允许 Claude',
    perm_acceptEdits: '修改文件', perm_acceptEdits_d: '可修改项目内的文件，不执行命令。',
    perm_bypassPermissions: '完全放手', perm_bypassPermissions_d: '同时自动执行命令，不再询问。仅当你信任这些项目时使用。',
    perm_plan: '只读', perm_plan_d: '只阅读和规划，不改动任何文件。',
    set_startup: '开机时启动', set_startup_d: 'Baton 会安静地待在托盘里。',
    set_conn: '连接', connected: '已连接 Claude Code', not_connected: '未连接', disconnect: '断开',
    about: '关于', about_text: 'Baton 是独立工具，与 Anthropic 无关联。', replay_intro: '重播开场动画',
    danger: '危险操作', remove_all: '移除 Baton…', remove_all_d: '把 Baton 从 Claude Code 里拿掉，并恢复你的设置。',
    remove_all_title: '移除 Baton？',
    remove_all_confirm: '它加的钩子、工具和技能会被移除，你自己的 Claude Code 设置恢复原样。已保存的账号登录会保留，除非你勾选下面的选项。',
    remove_logins: '同时删除已保存的账号登录（之后每个账号都要重新登录）',
    removed_done: 'Baton 已移除，现在可以关闭并卸载这个应用了。',
    removed_kept: 'Baton 已从 Claude Code 里移除。你的账号登录仍然保留，之后重新设置 Baton 不用再登录。',
    email: '邮箱', email_hint: '用于预填登录页面，可不填。', cancel: '取消', continue: '继续', close: '关闭', save: '保存',
    add_title: '添加账号', add_sub: '会为这个账号单独打开一个浏览器窗口。',
    login_title: '完成登录', login_waiting: (x) => `已为 ${x} 打开浏览器窗口。请在其中完成登录，这里会自动继续。`,
    login_starting: '正在启动…', login_tip: '如果该浏览器已登录了另一个 Claude 账号，请改在隐私窗口中打开链接。',
    open_again: '重新打开', copy_link: '复制链接', copied: '链接已复制',
    code_title: '粘贴代码', code_sub: '登录后浏览器页面会显示一段代码，请粘贴到这里。', code_label: '代码', submit: '提交',
    login_done: '登录成功', login_failed: '登录未完成', try_again: '重试',
    no_claude: '这台电脑上没有找到 Claude Code。', get_claude: '安装 Claude Code',
    request_failed: (n) => `请求失败（${n}）`, unreachable: (m) => `无法连接 Baton：${m}`,
    n_leader: (p) => `领队已切换：这个窗口现在用的是 ${p.to || p.outside}`,
    n_done: (p) => `“${p.job.project}”已完成`,
    n_failed: (p) => `“${p.job.project}”未能完成`, n_needs_login: (p) => `${p.account} 需要重新登录`,
  },
};
let LANG = 'en';
const t = (k, ...a) => {
  const v = T[LANG][k] ?? T.en[k] ?? k;
  return typeof v === 'function' ? v(...a) : v;
};
function setLang(l) {
  LANG = l === 'zh' ? 'zh' : 'en';
  document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';
}
const LOCALE = () => (LANG === 'zh' ? 'zh-CN' : 'en-US');

/* ---------- DOM helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const SVGNS = 'http://www.w3.org/2000/svg';
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14 3h-4l-.6 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2L10 21h4l.6-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  down: '<path d="M7 10l5 5 5-5"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18"/>',
  spark: '<path d="M12 3.5c.7 4.3 2.9 6.6 7.2 7.3-4.3.7-6.5 2.9-7.2 7.2-.7-4.3-2.9-6.5-7.2-7.2 4.3-.7 6.5-3 7.2-7.3z"/>',
  layers: '<path d="M12 4l8.5 4.5L12 13 3.5 8.5z"/><path d="M3.5 12.5L12 17l8.5-4.5"/>',
  chat: '<path d="M5 18l-1 3 4-2h9a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3v9"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  login: '<path d="M10 17l5-5-5-5M15 12H3M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
};
function icon(name, cls = 'ic') {
  const s = document.createElementNS(SVGNS, 'svg');
  for (const [k, v] of Object.entries({ class: cls, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, v);
  s.innerHTML = ICONS[name]; // constant markup from ICONS above
  return s;
}
function markSvg() {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 32 32');
  s.setAttribute('class', 'mark');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<circle cx="12" cy="16" r="8" fill="none" stroke="var(--clay)" stroke-width="2.6"/><circle cx="20" cy="16" r="8" fill="none" stroke="currentColor" stroke-width="2.6"/>';
  return s;
}
// h(tag, props, ...children). `on*` props add listeners: use them only in dialogs and menus, which are not morphed.
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) el.style.setProperty(p, x); // also --custom props
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) return c.forEach(add);
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

/* ---------- morph: patch the live DOM to match a freshly built tree ---------- */
// Elements are matched by data-key, else by position and tag. Matched elements are kept (so focus, scroll and
// running CSS animations stay) and only their attributes and text change.
const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') : null);
function morphNode(cur, next) {
  if (cur.nodeType !== 1) { if (cur.nodeValue !== next.nodeValue) cur.nodeValue = next.nodeValue; return; }
  for (const { name } of [...cur.attributes]) if (!next.hasAttribute(name)) cur.removeAttribute(name);
  for (const { name, value } of next.attributes) if (cur.getAttribute(name) !== value) cur.setAttribute(name, value);
  morphChildren(cur, next);
}
function morphChildren(cur, next) {
  const want = [...next.childNodes];
  const keyed = new Map();
  for (const n of cur.childNodes) { const k = keyOf(n); if (k) keyed.set(k, n); }
  want.forEach((nn, i) => {
    const at = cur.childNodes[i] || null;
    const k = keyOf(nn);
    let m = null;
    if (k) {
      const c = keyed.get(k);
      if (c && c.nodeName === nn.nodeName) { m = c; keyed.delete(k); }
    } else if (at && !keyOf(at) && at.nodeType === nn.nodeType && at.nodeName === nn.nodeName) m = at;
    if (m) { if (m !== at) cur.insertBefore(m, at); morphNode(m, nn); } else cur.insertBefore(nn, at);
  });
  while (cur.childNodes.length > want.length) cur.lastChild.remove();
}
function patch(root, kids) {
  const next = document.createElement('div');
  const add = (c) => { if (Array.isArray(c)) c.forEach(add); else if (c) next.append(c); };
  add(kids);
  morphChildren(root, next);
}

/* ---------- formatting ---------- */
function fmtTime(sec) {
  const d = new Date(sec * 1000);
  const today = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(LOCALE(), { hour: 'numeric', minute: '2-digit' });
  return today ? time : `${d.toLocaleDateString(LOCALE(), { weekday: 'short' })} ${time}`;
}
function fmtCountdown(sec) {
  const s = Math.max(0, Math.floor(sec - Date.now() / 1000));
  const p = (n) => String(n).padStart(2, '0');
  const hh = Math.floor(s / 3600);
  return hh ? `${hh}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`;
}
// How long ago a reading was taken; refreshed by the one-second ticker without re-rendering.
function fmtAge(at) {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 5) return t('age_now');
  if (s < 60) return t('age_s', s);
  if (s < 3600) return t('age_m', Math.floor(s / 60));
  if (s < 86400) return t('age_h', Math.floor(s / 3600));
  return t('age_d', Math.floor(s / 86400));
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const baseName = (p) => String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

/* ---------- api, toasts ---------- */
async function api(path, body) {
  const res = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || t('request_failed', res.status));
  return data;
}
function toast(text) {
  const el = h('div', { class: 'toast' }, text);
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 200); }, 5000);
}
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message); } };

/* ---------- state ---------- */
const S = {
  accounts: [], jobs: { active: [], recent: [] }, runs: [], connect: { all: false }, leader: null,
  desktop: { detected: false, pending: false }, cli: { loggedIn: false, checked: false }, settings: {},
  login: null, claudeProblem: null, canAutoStart: false,
  tab: 'overview', view: 'main', autoStart: null, dirty: false, scroll: {}, recent: [], manual: {}, tabAnim: null,
};
try { if (localStorage.getItem('baton.tab') === 'accounts') S.tab = 'accounts'; } catch { /* storage unavailable */ }
const acctOf = (name) => S.accounts.find((a) => a.name === name);

/* ---------- motion ---------- */
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// "fresh" is true for a short while after something is first seen on screen, so it can animate in once
// (usage bars grow, percentages count up) and not again on every update or tab switch.
const SEEN = new Map();
function fresh(key, visible) {
  if (reducedMotion()) return false;
  const at = SEEN.get(key);
  if (at === undefined) {
    if (!visible) return false;
    SEEN.set(key, performance.now());
    return true;
  }
  return performance.now() - at < 800;
}
const onScreen = (where) => !BOOT.on && S.view === 'main' && S.tab === where;
const COUNTED = new WeakSet();
function countUp() {
  document.querySelectorAll('[data-count]').forEach((el) => {
    if (COUNTED.has(el)) return;
    COUNTED.add(el);
    const to = Number(el.dataset.count);
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 500);
      el.textContent = `${Math.round(to * (1 - (1 - p) ** 3))}%`;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/* ---------- launch intro ---------- */
// index.html marks <html class="booting"> on the first load after the app starts (src/intro.js decides);
// the splash animates in CSS while the panel loads underneath, then fades away as the panel rises in.
const BOOT = { on: document.documentElement.classList.contains('booting'), timer: 0 };
const INTRO_MS = 1650;
function startIntro() {
  if (reducedMotion()) return;
  const root = document.documentElement;
  closeMenu(false);
  root.classList.remove('booting', 'boot-out', 'revealing');
  void $('#boot').offsetWidth; // restart the CSS animations
  root.classList.add('booting');
  BOOT.on = true;
  clearTimeout(BOOT.timer);
  BOOT.timer = setTimeout(endIntro, INTRO_MS);
}
function endIntro() {
  if (!BOOT.on) return;
  BOOT.on = false;
  clearTimeout(BOOT.timer);
  const root = document.documentElement;
  root.classList.add('boot-out', 'revealing');
  render();
  setTimeout(() => { if (!BOOT.on) root.classList.remove('booting', 'boot-out'); }, 420);
  setTimeout(() => { if (!BOOT.on) root.classList.remove('revealing'); }, 1100);
}
// any click or key press skips the intro at once (and does not reach the panel underneath)
const skipIntro = (e) => { if (BOOT.on) { e.preventDefault(); e.stopPropagation(); endIntro(); } };
document.addEventListener('pointerdown', skipIntro, true);
document.addEventListener('keydown', skipIntro, true);
window.batonIntro = startIntro;
if (BOOT.on) { if (reducedMotion()) { BOOT.on = false; document.documentElement.classList.remove('booting'); } else BOOT.timer = setTimeout(endIntro, INTRO_MS); }
const labelOf = (name) => acctOf(name)?.label || name;

/* ---------- leader and setup ---------- */
function leaderAccount() {
  const email = (S.leader && S.leader.email || '').toLowerCase();
  return (email && S.accounts.find((a) => a.label.toLowerCase() === email)) || S.accounts.find((a) => a.desktop) || null;
}
const leaderEmail = () => (S.leader && S.leader.email) || leaderAccount()?.label || '';
function setupStatus() {
  const s1 = S.accounts.length > 0;
  const s2 = !!leaderEmail(); // recognised by itself; it informs, it never blocks setup
  const s3 = !!S.connect.all;
  return { s1, s2, s3, complete: s1 && s3 };
}
const autoStartChoice = () => (S.autoStart ?? S.settings.startAtLogin !== false);

/* ---------- small building blocks ---------- */
const TINTS = ['#9a6a45', '#3f6c99', '#56693d', '#9a4565', '#655f9a']; // dark enough for white initials (>= 4.5:1)
const tintOf = (name) => TINTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length];
const R = 16.5;
const CIRC = 2 * Math.PI * R;

// The avatar's ring: how much of a limited account's window is still to recharge; full while working.
function avatar(a, cls = '') {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('aria-hidden', 'true');
  if (a) {
    const win = (a.blockedReason || '').startsWith('seven_day') ? 7 * 86400 : (a.blockedReason === 'rate' ? 60 : 5 * 3600);
    const left = Math.max(0, Math.min(1, (a.blockedUntil - Date.now() / 1000) / win));
    const shown = a.active ? 1 : a.status === 'limited' ? left : a.status === 'login' ? 1 : 0;
    const mk = (c, off) => {
      const el = document.createElementNS(SVGNS, 'circle');
      for (const [k, v] of Object.entries({ class: c, cx: 18, cy: 18, r: R, 'stroke-dasharray': CIRC.toFixed(2), 'stroke-dashoffset': off.toFixed(2) })) el.setAttribute(k, v);
      return el;
    };
    svg.append(mk('track', 0), mk('ring', CIRC * (1 - shown)));
  }
  const label = a ? a.label : (S.leader && S.leader.email) || '';
  return h('span', { class: `avatar ${cls}` }, svg, h('i', { style: { '--tint': tintOf(a ? a.name : label || '?') } }, (label[0] || '?').toUpperCase()));
}
const stateOf = (a) => (a.active ? 'working' : a.status);
function statusLine(a) {
  const s = stateOf(a);
  const text = s === 'working' ? t('working')
    : s === 'limited' ? [t('limited'), ' · ', t('back_in_pre'), h('span', { class: 'num', 'data-cd': a.blockedUntil }, fmtCountdown(a.blockedUntil)), t('back_in_post')]
      : s === 'login' ? t('signin_needed') : t('ready');
  return h('div', { class: `status s-${s}`, title: s === 'limited' ? t('resets_at', fmtTime(a.blockedUntil)) : null }, h('i', { class: 'dot' }), h('span', {}, text));
}
// The spinner is for readings someone is waiting for: an account's first one, or after pressing Refresh.
// Background re-reads (every 30 s while the window is open) only move the quiet "Updated …" text.
function manualPending(a) {
  const at = S.manual[a.name];
  if (!at) return false;
  if ((a.usageAt || 0) >= at || Date.now() - at > 90000) { delete S.manual[a.name]; return false; }
  return true;
}
function usageBlock(a, where) {
  const u = a.usage;
  if (!u || !(u.session || u.week)) {
    if (a.status === 'login') return null;
    const reading = a.usageBusy || manualPending(a);
    return h('div', { class: 'u-note', title: a.usageError || null }, reading ? h('span', { class: 'spin sm' }) : null, reading ? t('usage_reading') : t('usage_unavailable'));
  }
  const row = (kind, name, r) => {
    if (!r) return null;
    const pct = Math.round(r.pct);
    const isNew = fresh(`${where}:${a.name}:${kind}`, onScreen(where));
    return h('div', { class: 'u-row' },
      h('span', { class: 'u-k' }, name),
      h('span', { class: 'u-bar', role: 'progressbar', 'aria-label': name, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) },
        h('i', { class: `${r.pct >= 90 ? 'hot' : r.pct >= 70 ? 'warm' : ''} ${isNew ? 'grow' : ''}`.trim(), style: { '--p': (Math.min(100, Math.max(2, r.pct)) / 100).toFixed(3) } })),
      h('span', { class: 'u-pct num', 'data-count': isNew ? String(pct) : null }, `${pct}%`),
      h('span', { class: 'u-reset', title: r.resetsAt ? fmtTime(r.resetsAt) : null }, r.resetsAt ? t('resets_at', fmtTime(r.resetsAt)) : ''));
  };
  return h('div', { class: 'usage' }, row('5h', t('usage_5h'), u.session), row('wk', t('usage_wk'), u.week));
}
function ageLine(a) {
  if (a.usage && manualPending(a)) return h('span', { class: 'age' }, h('span', { class: 'spin sm' }), t('usage_updating'));
  if (!a.usageAt || !a.usage) return null;
  return h('span', { class: 'age' }, t('updated_pre'), h('span', { 'data-age': a.usageAt }, fmtAge(a.usageAt)), t('updated_post'));
}

// Which model this account's worker runs use by default. The leader is left out: its model is set in the Claude window.
const MODEL_CHOICES = ['haiku', 'sonnet', 'opus'];
const modelName = (m) => (!m ? t('model_default') : MODEL_CHOICES.includes(m) ? t(`model_${m}`) : m);
function modelChip(a) {
  const name = modelName(a.model);
  return h('button', { class: 'chip-btn', type: 'button', 'data-act': 'model', 'data-name': a.name, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': t('model_aria', name), title: t('model_tip') },
    icon('layers', 'ic sm'), h('span', {}, name), icon('down', 'ic xs'));
}

/* ---------- account cards ---------- */
function accountCard(a, { overview = false } = {}) {
  const s = stateOf(a);
  const foot = [
    !overview && !a.desktop ? modelChip(a) : null,
    a.status === 'login' ? h('button', { class: 'btn sm', type: 'button', 'data-act': 'signin', 'data-name': a.name }, icon('login', 'ic sm'), t('sign_in')) : null,
    ageLine(a),
  ].filter(Boolean);
  return h('article', { class: `card acct is-${s}`, 'data-key': `a-${a.name}`, 'aria-label': a.label },
    h('div', { class: 'acct-head' },
      avatar(a),
      h('div', { class: 'acct-id' },
        h('div', { class: 'acct-line' },
          h('span', { class: 'email selectable', title: a.label }, a.label),
          a.desktop && !overview ? h('span', { class: 'tag accent' }, t('leader_tag')) : null,
          a.plan ? h('span', { class: 'tag' }, cap(a.plan)) : null),
        statusLine(a)),
      overview ? null : h('button', { class: 'icon-btn', type: 'button', 'data-act': 'more', 'data-name': a.name, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': t('more_actions', a.label), title: t('more_actions', a.label) }, icon('more'))),
    usageBlock(a, overview ? 'overview' : 'accounts'),
    foot.length ? h('div', { class: 'acct-foot' }, foot) : null);
}

/* ---------- jobs ---------- */
// A worker's last tool call ("Edit src/app.js") told the friendly way ("Editing app.js"); prose stays as it is.
const VERBS = {
  Read: ['v_read', 'file', true], Edit: ['v_edit', 'pencil', true], MultiEdit: ['v_edit', 'pencil', true], NotebookEdit: ['v_edit', 'pencil', true],
  Write: ['v_write', 'file', true], Bash: ['v_run', 'terminal'], PowerShell: ['v_run', 'terminal'], Grep: ['v_search', 'search', 'base'],
  Glob: ['v_find', 'search'], LS: ['v_list', 'search', 'base'], WebFetch: ['v_fetch', 'globe'], WebSearch: ['v_web', 'globe'],
  TodoWrite: ['v_plan', 'check'], Task: ['v_agent', 'spark'], Agent: ['v_agent', 'spark'],
};
function liveLine(line) {
  const raw = String(line || '').trim();
  const sp = raw.search(/\s/);
  const tool = sp < 0 ? raw : raw.slice(0, sp);
  let arg = sp < 0 ? '' : raw.slice(sp + 1).trim();
  if (arg.startsWith('{')) arg = (/"(?:query|description|prompt|command|file_path|path|pattern|url)"\s*:\s*"([^"]*)/.exec(arg) || [])[1] || '';
  const mcp = /^mcp__.+?__(.+)$/.exec(tool);
  if (mcp) return { ic: 'spark', text: t('v_use', mcp[1].replace(/_/g, ' ')) };
  const v = VERBS[tool];
  if (!v) return { ic: 'chat', text: raw, prose: true };
  const [key, ic, isPath] = v;
  if (isPath && arg) {
    if (isPath === true && !/[\\/.]/.test(arg)) return { ic: 'chat', text: raw, prose: true }; // prose that happens to start with "Read"
    arg = baseName(arg);
  }
  if (key === 'v_fetch') { try { arg = new URL(arg).host; } catch { /* keep as is */ } }
  return { ic, text: t(key, arg).trim() };
}
function liveRow(line) {
  if (!line) return null;
  const l = liveLine(line);
  return h('div', { class: `job-live ${l.prose ? 'prose' : ''}`, title: line }, icon(l.ic, 'ic sm'), h('span', {}, l.text));
}
function workerLine(account, model) {
  if (!account) return h('div', { class: 'job-who' }, h('span', { class: 'who' }, t('starting')));
  return h('div', { class: 'job-who' }, h('span', { class: 'who selectable', title: labelOf(account) }, labelOf(account)), model ? h('span', { class: 'model', title: model }, ` · ${model}`) : null);
}
function runCard(r) {
  const waiting = r.status === 'waiting';
  return h('article', { class: `card job ${waiting ? 'waiting' : ''}`, 'data-key': `r-${r.id}` },
    h('div', { class: 'job-top' }, h('span', { class: 'job-proj', title: r.cwd }, r.project), r.thread ? h('span', { class: 'tag', title: r.thread }, r.thread) : null),
    r.title ? h('div', { class: 'job-title selectable', title: r.title }, r.title) : null,
    workerLine(r.account, r.model || acctOf(r.account)?.model || ''),
    waiting && r.waitingUntil ? h('div', { class: 'job-meta' }, t('waiting_until', fmtTime(r.waitingUntil)), ' ', h('b', { class: 'num', 'data-cd': r.waitingUntil }, fmtCountdown(r.waitingUntil))) : null,
    liveRow(r.lastLine),
    h('div', { class: 'progress', 'aria-hidden': 'true' }));
}
function takeoverCard(j) {
  const waiting = j.status === 'waiting';
  return h('article', { class: `card job ${waiting ? 'waiting' : ''}`, 'data-key': `j-${j.id}` },
    h('div', { class: 'job-top' }, h('span', { class: 'job-proj', title: j.cwd }, j.project), h('span', { class: 'tag accent' }, t('takeover_tag')),
      h('button', { class: 'btn sm quiet', type: 'button', 'data-act': 'stop', 'data-id': j.id }, icon('stop', 'ic sm'), t('stop'))),
    waiting && j.waitingUntil
      ? h('div', { class: 'job-meta' }, t('waiting_until', fmtTime(j.waitingUntil)), ' ', h('b', { class: 'num', 'data-cd': j.waitingUntil }, fmtCountdown(j.waitingUntil)))
      : h('div', { class: 'job-who' }, h('span', { class: 'who' }, j.account ? t('continuing_on', labelOf(j.account)) : t('starting'))),
    liveRow(j.lastLine),
    h('div', { class: 'progress', 'aria-hidden': 'true' }));
}
// Recent: finished takeovers and worker runs (from the project ledgers), newest first, one line each.
function recentItems() {
  const takeovers = S.jobs.recent.map((j) => ({
    key: `j-${j.id}`, ok: j.status === 'done', state: j.status === 'done' ? 'finished' : j.status === 'stopped' ? 'stopped' : 'failed',
    title: j.title || j.project, project: j.project, account: j.account || '', at: j.finishedAt || 0,
  }));
  const runs = (S.recent || []).map((r) => ({
    key: `w-${r.at}-${r.project}-${r.thread}`, ok: r.ok, state: r.ok ? 'finished' : 'failed',
    title: r.title || r.thread || r.project, project: r.project, account: r.account, at: r.at,
  }));
  return [...takeovers, ...runs].sort((a, b) => b.at - a.at).slice(0, 5);
}
function recentRow(it) {
  const who = it.account ? labelOf(it.account) : '';
  const meta = [it.project, who].filter(Boolean).join(' · ');
  return h('li', { class: `recent-row ${it.ok ? 'ok' : 'bad'}`, 'data-key': it.key, title: `${it.title}\n${meta} · ${t(it.state)}` },
    icon(it.ok ? 'check' : 'alert', 'ic sm'), h('span', { class: 'sr' }, t(it.state)),
    h('span', { class: 'recent-title' }, it.title),
    meta ? h('span', { class: 'recent-meta' }, meta) : null,
    it.at ? h('time', { class: 'num', 'data-age': it.at, datetime: new Date(it.at).toISOString() }, fmtAge(it.at)) : null);
}

/* ---------- setup checklist ---------- */
function switchBtn(on, act, label) {
  return h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, 'data-act': act }, h('i'));
}
function setupCard() {
  const st = setupStatus();
  const firstOpen = !st.s1 ? 1 : !st.s3 ? 3 : !st.s2 ? 2 : 0;
  const doneN = [st.s1, st.s2, st.s3].filter(Boolean).length;
  const who = leaderEmail();
  const inPool = S.accounts.some((a) => a.desktop);
  // step 2 resolves on its own, so it is never greyed out as if it were locked
  const step = (n, done, title, body) => {
    const later = !done && n !== firstOpen && n > firstOpen && n !== 2;
    return h('li', { class: `step ${done ? 'done' : n === firstOpen ? 'now' : later ? 'later' : ''}`, 'data-key': `s${n}` },
      h('span', { class: 'step-n', 'aria-hidden': 'true' }, done ? icon('check', 'ic xs') : String(n)),
      h('div', { class: 'step-body' }, h('div', { class: 'step-title' }, title), done || later ? null : body));
  };
  return h('section', { class: 'card setup', 'aria-labelledby': 'setup-h', 'data-key': 'setup' },
    h('div', { class: 'setup-head' }, h('h2', { id: 'setup-h' }, t('get_started')), h('span', { class: 'muted num' }, t('setup_progress', doneN))),
    h('ol', { class: 'steps' },
      step(1, st.s1, t('s1'), [h('p', {}, t('s1_sub')),
        h('div', { class: 'acts' },
          S.cli.loggedIn ? h('button', { class: 'btn primary', type: 'button', 'data-act': 'import' }, t('use_current')) : null,
          h('button', { class: S.cli.loggedIn ? 'btn' : 'btn primary', type: 'button', 'data-act': 'add' }, icon('plus', 'ic sm'), t('add_account'))),
        S.cli.checked && !S.cli.loggedIn ? h('p', { class: 'tip' }, t('s1_cli_missing')) : null]),
      step(2, st.s2, t('s2'), [h('p', {}, who ? t('s2_known', who) : S.desktop.detected ? t('s2_pending') : t('s2_none')),
        who ? h('p', { class: 'tip' }, inPool ? t('s2_known_pool') : t('s2_known_outside'))
          : S.accounts.length ? h('div', { class: 'chips' }, S.accounts.map((a) =>
            h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(!!a.desktop), 'data-act': 'leader', 'data-name': a.name, 'data-key': a.name, title: a.label }, h('span', {}, a.label)))) : null]),
      step(3, st.s3, t('s3'), [h('p', {}, t('s3_sub')),
        h('div', { class: 'acts' }, h('button', { class: 'btn primary', type: 'button', 'data-act': 'connect', disabled: !st.s1 || undefined }, t('connect'))),
        S.canAutoStart ? h('div', { class: 'switch-row' }, h('span', {}, t('start_login')), switchBtn(autoStartChoice(), 'setup-autostart', t('start_login'))) : null])));
}

/* ---------- views ---------- */
function titlebar() {
  const st = setupStatus();
  const busy = S.jobs.active.length + S.runs.length;
  const pill = busy ? ['busy', t('working_n', busy)] : st.complete ? ['ok', t('watching')] : ['setup', t('needs_setup')];
  return [
    h('div', { class: 'brand' }, markSvg(), h('span', {}, t('app'))),
    h('span', { class: `pill ${pill[0]}`, role: 'status' }, h('i', { class: 'dot' }), pill[1]),
    h('button', { class: `icon-btn gear ${S.view === 'settings' ? 'on' : ''}`, type: 'button', 'data-act': 'settings', 'aria-label': t('open_settings'), 'aria-pressed': String(S.view === 'settings'), title: t('settings') }, icon('gear')),
  ];
}
function tabsBar() {
  const tab = (id) => h('button', {
    class: 'seg-btn', type: 'button', role: 'tab', id: `tab-${id}`, 'aria-controls': `panel-${id}`, 'aria-selected': String(S.tab === id),
    tabindex: S.tab === id ? '0' : '-1', 'data-act': 'tab', 'data-tab': id,
  }, t(`tab_${id}`));
  return h('div', { class: 'tabs-bar' }, h('div', { class: 'seg', role: 'tablist', 'aria-label': t('tabs') }, tab('overview'), tab('accounts')));
}
function overviewPanel() {
  const st = setupStatus();
  const out = [];
  if (S.claudeProblem) {
    out.push(h('div', { class: 'notice warn', role: 'alert', 'data-key': 'noclaude' }, icon('alert', 'ic sm'), h('span', {}, t('no_claude')),
      h('a', { href: 'https://claude.com/claude-code', target: '_blank', rel: 'noopener' }, t('get_claude'), icon('external', 'ic xs'))));
  }
  if (!st.complete) out.push(setupCard());

  // This window (the leader)
  const lead = leaderAccount();
  const outside = S.leader && !S.leader.registered && S.leader.email;
  if (st.complete || lead || outside) {
    let body;
    if (outside) {
      body = h('article', { class: 'card acct', 'data-key': 'lead-out' },
        h('div', { class: 'acct-head' }, avatar(null),
          h('div', { class: 'acct-id' }, h('div', { class: 'acct-line' }, h('span', { class: 'email selectable', title: S.leader.email }, S.leader.email), h('span', { class: 'tag' }, t('not_in_pool'))),
            h('div', { class: 'hint' }, t('leader_outside')))),
        h('div', { class: 'acct-foot' }, h('button', { class: 'btn sm', type: 'button', 'data-act': 'add', 'data-email': S.leader.email }, icon('plus', 'ic sm'), t('add_this'))));
    } else if (lead) {
      body = accountCard(lead, { overview: true });
    } else {
      body = h('div', { class: 'card empty', 'data-key': 'lead-none' }, icon('monitor', 'ic'), h('p', {}, t('leader_pending')));
    }
    out.push(h('section', { class: 'section', 'aria-labelledby': 'h-window', 'data-key': 'window' }, h('div', { class: 'section-head' }, h('h2', { class: 'label', id: 'h-window' }, t('this_window'))), body));
  }

  // Activity
  const running = [...S.runs.map(runCard), ...S.jobs.active.map(takeoverCard)];
  const recent = recentItems();
  if (st.complete || running.length || recent.length) {
    out.push(h('section', { class: 'section', 'aria-labelledby': 'h-act', 'data-key': 'activity' },
      h('div', { class: 'section-head' }, h('h2', { class: 'label', id: 'h-act' }, t('activity')), running.length ? h('span', { class: 'count num' }, String(running.length)) : null),
      running.length ? h('div', { class: 'stack', 'data-key': 'running' }, running) : h('div', { class: 'card empty', 'data-key': 'idle' }, icon('check', 'ic'), h('p', {}, t('idle'))),
      recent.length ? h('div', { class: 'recent', 'data-key': 'recent' }, h('h3', { class: 'sublabel' }, t('recent')), h('ul', { class: 'card list' }, recent.map(recentRow))) : null));
  }
  return out;
}
function accountsPanel() {
  return [
    h('section', { class: 'section', 'aria-labelledby': 'h-accts' },
      h('div', { class: 'section-head' }, h('h2', { class: 'label', id: 'h-accts' }, t('accounts')), h('span', { class: 'count num' }, String(S.accounts.length)),
        h('button', { class: 'icon-btn sm push', type: 'button', 'data-act': 'refresh', 'aria-label': t('refresh_usage'), title: t('refresh_usage') }, icon('refresh'))),
      h('div', { class: 'stack' }, S.accounts.map((a) => accountCard(a))),
      h('button', { class: 'add-row', type: 'button', 'data-act': 'add' }, icon('plus', 'ic sm'), t('add_account'))),
  ];
}
function mainView() {
  return [
    tabsBar(),
    h('div', { class: 'scroll', id: 'main-scroll', 'data-anim': S.tabAnim },
      h('div', { class: 'panel', role: 'tabpanel', id: 'panel-overview', 'aria-labelledby': 'tab-overview', hidden: S.tab !== 'overview' || undefined }, overviewPanel()),
      h('div', { class: 'panel', role: 'tabpanel', id: 'panel-accounts', 'aria-labelledby': 'tab-accounts', hidden: S.tab !== 'accounts' || undefined }, accountsPanel())),
  ];
}
const PERMS = ['acceptEdits', 'bypassPermissions', 'plan'];
function settingsView() {
  const lang = S.settings.language === 'zh' ? 'zh' : 'en';
  const perm = S.settings.permissionMode || 'acceptEdits';
  const group = (id, title, ...body) => h('section', { class: 'group', 'aria-labelledby': `g-${id}` }, h('h2', { class: 'label', id: `g-${id}` }, title), ...body);
  const langBtn = (l, label) => h('button', { class: 'seg-btn', type: 'button', role: 'radio', 'aria-checked': String(lang === l), tabindex: lang === l ? '0' : '-1', 'data-act': 'lang', 'data-lang': l, lang: l === 'zh' ? 'zh-CN' : 'en' }, label);
  return [
    h('div', { class: 'page-head' },
      h('button', { class: 'icon-btn', type: 'button', 'data-act': 'back', 'aria-label': t('back'), title: t('back') }, icon('back')),
      h('h1', { id: 'set-h' }, t('settings'))),
    h('div', { class: 'scroll', id: 'settings-scroll' }, h('div', { class: 'panel' },
      group('lang', t('set_lang'), h('div', { class: 'card row' },
        h('div', { class: 'seg wide', role: 'radiogroup', 'aria-labelledby': 'g-lang' }, langBtn('en', 'English'), langBtn('zh', '中文')))),
      group('perm', t('set_perm'), h('div', { class: 'card list', role: 'radiogroup', 'aria-labelledby': 'g-perm' }, PERMS.map((m) =>
        h('button', { class: 'radio-row', type: 'button', role: 'radio', 'aria-checked': String(m === perm), tabindex: m === perm ? '0' : '-1', 'data-act': 'perm', 'data-mode': m },
          h('i', { class: 'radio' }), h('span', { class: 'rr-text' }, h('b', {}, t(`perm_${m}`)), h('small', {}, t(`perm_${m}_d`))))))),
      S.canAutoStart ? group('startup', t('set_startup'), h('div', { class: 'card row' },
        h('div', { class: 'row-text' }, h('b', {}, t('set_startup')), h('small', {}, t('set_startup_d'))),
        switchBtn(S.settings.startAtLogin !== false, 'autostart', t('set_startup')))) : null,
      group('conn', t('set_conn'), h('div', { class: 'card row' },
        h('div', { class: `row-text status ${S.connect.all ? 's-ready' : 's-off'}` }, h('i', { class: 'dot' }), h('span', {}, S.connect.all ? t('connected') : t('not_connected'))),
        S.connect.all ? h('button', { class: 'btn sm', type: 'button', 'data-act': 'disconnect' }, t('disconnect'))
          : h('button', { class: 'btn sm primary', type: 'button', 'data-act': 'connect', disabled: !S.accounts.length || undefined }, t('connect')))),
      group('about', t('about'), h('div', { class: 'card row' }, h('div', { class: 'row-text' }, h('small', {}, t('about_text'))),
        h('button', { class: 'link-btn', type: 'button', 'data-act': 'intro' }, t('replay_intro')))),
      group('danger', t('danger'), h('div', { class: 'card row danger' },
        h('div', { class: 'row-text' }, h('small', {}, t('remove_all_d'))),
        h('button', { class: 'btn sm danger', type: 'button', 'data-act': 'remove-all' }, t('remove_all')))))),
  ];
}

/* ---------- render ---------- */
let queued = false;
function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; render(); });
}
function render() {
  // A menu is anchored to a button in the panel: hold updates until it closes, then catch up.
  if (MENU) { S.dirty = true; return; }
  S.dirty = false;
  patch($('#titlebar'), titlebar());
  patch($('#main'), mainView());
  patch($('#settings'), settingsView());
  const open = S.view === 'settings';
  $('#app').classList.toggle('settings-open', open);
  $('#main').inert = open;
  $('#settings').inert = !open;
  $('#settings').setAttribute('aria-labelledby', 'set-h');
  countUp();
}

function setTab(tab, focus) {
  if (tab === S.tab) return;
  const sc = $('#main-scroll');
  if (sc) S.scroll[S.tab] = sc.scrollTop;
  // the new panel fades in with a slight slide from the side it comes from
  S.tabAnim = reducedMotion() ? null : tab === 'accounts' ? 'right' : 'left';
  clearTimeout(setTab.timer);
  setTab.timer = setTimeout(() => { S.tabAnim = null; schedule(); }, 600);
  S.tab = tab;
  try { localStorage.setItem('baton.tab', tab); } catch { /* storage unavailable */ }
  render();
  if (sc) sc.scrollTop = S.scroll[tab] || 0;
  if (focus) $(`#tab-${tab}`)?.focus();
}
function openSettings() {
  S.view = 'settings';
  render();
  setTimeout(() => $('#settings [data-act="back"]')?.focus(), 30);
}
function closeSettings() {
  S.view = 'main';
  render();
  $('#titlebar [data-act="settings"]')?.focus();
}

/* ---------- menus (popover) ---------- */
// items: { label, hint?, checked?, danger?, run } or 'sep'. Arrow keys, Home/End, Enter/Space, Esc; focus goes back to the anchor.
let MENU = null;
function openMenu(anchor, items, label) {
  closeMenu(false);
  const els = [];
  const radio = items.some((it) => it !== 'sep' && it.checked !== undefined);
  const menu = h('div', { class: 'menu', role: 'menu', 'aria-label': label, tabindex: '-1' },
    items.map((it) => {
      if (it === 'sep') return h('div', { class: 'menu-sep', role: 'separator' });
      const el = h('button', {
        class: `menu-item ${it.danger ? 'danger' : ''}`, type: 'button', role: radio ? 'menuitemradio' : 'menuitem', tabindex: '-1',
        'aria-checked': radio ? String(!!it.checked) : null,
        onclick: () => { closeMenu(true); it.run(); },
      }, radio ? h('span', { class: 'menu-check' }, it.checked ? icon('check', 'ic xs') : null) : null,
      it.icon ? icon(it.icon, 'ic sm') : null,
      h('span', { class: 'menu-label' }, it.label), it.hint ? h('small', {}, it.hint) : null);
      els.push(el);
      return el;
    }));
  $('#layer').append(menu);
  // place under the anchor, flipped up when there is no room, kept inside the window
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw > 8 && r.left + mw > window.innerWidth - 8 ? r.right - mw : r.left));
  const below = r.bottom + 4 + mh <= window.innerHeight - 8;
  menu.style.left = `${left}px`;
  menu.style.top = `${below ? r.bottom + 4 : Math.max(8, r.top - 4 - mh)}px`;
  menu.style.transformOrigin = `${Math.round(r.left + r.width / 2 - left)}px ${below ? '0' : '100%'}`; // scales in from its button
  menu.classList.add(below ? 'from-top' : 'from-bottom');
  anchor.setAttribute('aria-expanded', 'true');
  MENU = { menu, anchor, els };
  const start = els.findIndex((e) => e.getAttribute('aria-checked') === 'true');
  (els[start < 0 ? 0 : start] || menu).focus();

  menu.addEventListener('keydown', (e) => {
    const i = els.indexOf(document.activeElement);
    const go = (n) => { e.preventDefault(); els[(n + els.length) % els.length].focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i < 0 ? els.length - 1 : i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(els.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
    else if (e.key === 'Tab') { e.preventDefault(); closeMenu(true); }
  });
}
function closeMenu(returnFocus) {
  if (!MENU) return;
  const { menu, anchor } = MENU;
  MENU = null;
  menu.remove();
  anchor.setAttribute('aria-expanded', 'false');
  if (returnFocus && anchor.isConnected) anchor.focus();
  if (S.dirty) render();
}
document.addEventListener('pointerdown', (e) => { if (MENU && !MENU.menu.contains(e.target) && !MENU.anchor.contains(e.target)) closeMenu(false); }, true);
window.addEventListener('resize', () => closeMenu(false));
window.addEventListener('blur', () => closeMenu(false));
document.addEventListener('scroll', (e) => { if (MENU && !MENU.menu.contains(e.target)) closeMenu(false); }, true);

function modelMenu(anchor, a) {
  const pick = (model) => guard(() => api('/api/accounts/model', { name: a.name, model }));
  const custom = a.model && !MODEL_CHOICES.includes(a.model);
  openMenu(anchor, [
    { label: t('model_default'), checked: !a.model, run: pick('') },
    ...MODEL_CHOICES.map((m) => ({ label: t(`model_${m}`), hint: t(`model_${m}_d`), checked: a.model === m, run: pick(m) })),
    custom ? { label: a.model, checked: true, run: () => {} } : null,
    'sep',
    { label: t('model_custom'), checked: false, run: () => openModelDialog(a) },
  ].filter(Boolean), t('model_label'));
}
function moreMenu(anchor, a) {
  openMenu(anchor, [
    a.desktop ? null : { label: t('set_leader'), icon: 'monitor', run: guard(() => api('/api/accounts/desktop', { name: a.name })) },
    { label: t('refresh_usage'), icon: 'refresh', run: guard(() => { S.manual[a.name] = Date.now(); schedule(); return api('/api/usage/refresh', { name: a.name }); }) },
    { label: t('signin_again'), icon: 'login', run: guard(() => api('/api/accounts/login', { name: a.name })) },
    'sep',
    { label: t('remove'), icon: 'trash', danger: true, run: guard(() => removeAccount(a)) },
  ].filter(Boolean), t('more_actions', a.label));
}

/* ---------- sheets (dialogs) ---------- */
let sheetId = 0;
function sheet(build) {
  const prev = document.activeElement;
  const d = h('dialog', { class: 'sheet' });
  d.addEventListener('close', () => {
    d.remove();
    if (prev && prev.isConnected && typeof prev.focus === 'function') prev.focus();
  });
  document.body.append(d);
  build(d);
  const title = d.querySelector('h2');
  if (title) { title.id = title.id || `sheet-h${++sheetId}`; d.setAttribute('aria-labelledby', title.id); }
  d.showModal();
  return d;
}
const actions = (...btns) => h('div', { class: 'sheet-actions' }, btns);
const btn = (label, onclick, cls = '') => h('button', { class: `btn ${cls}`, type: 'button', onclick }, label);
function confirmSheet(title, message, okLabel, { danger = false } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    sheet((d) => {
      d.addEventListener('close', () => resolve(ok));
      const yes = btn(okLabel, () => { ok = true; d.close(); }, danger ? 'danger-fill' : 'primary');
      d.append(h('h2', {}, title), h('p', {}, message), actions(btn(t('cancel'), () => d.close()), yes));
      setTimeout(() => yes.focus(), 30);
    });
  });
}
async function removeAccount(a) {
  if (await confirmSheet(t('confirm_remove_title'), t('confirm_remove', a.label), t('remove'), { danger: true })) await api('/api/accounts/remove', { name: a.name });
}
function inputSheet({ title, sub, label, type = 'text', placeholder = '', value = '', hint, submit, okLabel }) {
  sheet((d) => {
    const id = `in${++sheetId}`;
    const input = h('input', { type, id, placeholder, autocomplete: 'off', spellcheck: 'false', value });
    const go = guard(async () => { await submit(input.value); d.close(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
    d.append(h('h2', {}, title), sub ? h('p', {}, sub) : null, h('label', { class: 'field-label', for: id }, label), input, hint ? h('p', { class: 'tip' }, hint) : null,
      actions(btn(t('cancel'), () => d.close()), btn(okLabel || t('continue'), go, 'primary')));
    setTimeout(() => input.focus(), 30);
  });
}
function openAddDialog(prefill) {
  inputSheet({
    title: t('add_title'), sub: t('add_sub'), label: t('email'), type: 'email', placeholder: 'you@example.com',
    value: typeof prefill === 'string' ? prefill : '', hint: t('email_hint'), submit: (email) => api('/api/accounts', { email }),
  });
}
function openModelDialog(a) {
  inputSheet({
    title: t('model_custom_title'), sub: t('model_custom_sub'), label: t('model_label'), placeholder: 'claude-haiku-5-5',
    value: a.model || '', okLabel: t('save'), submit: (model) => api('/api/accounts/model', { name: a.name, model }),
  });
}
// Taking Baton out of Claude Code keeps the saved sign-ins unless the box is ticked: they are the one thing
// that costs a browser login each to get back.
function openRemoveAll() {
  sheet((d) => {
    const box = h('input', { type: 'checkbox', id: 'rmlogins' });
    const go = guard(async () => {
      const logins = box.checked;
      await api('/api/remove-all', { logins });
      d.close();
      document.body.replaceChildren(h('div', { class: 'app' },
        h('header', { class: 'titlebar' }, h('div', { class: 'brand' }, markSvg(), h('span', {}, t('app')))),
        h('div', { class: 'gone' }, markSvg(), h('p', {}, t(logins ? 'removed_done' : 'removed_kept')))));
    });
    d.append(h('h2', {}, t('remove_all_title')), h('p', {}, t('remove_all_confirm')),
      h('label', { class: 'check' }, box, h('span', {}, t('remove_logins'))),
      actions(btn(t('cancel'), () => d.close()), btn(t('remove'), go, 'danger-fill')));
  });
}

let loginDlg = null;
function renderLogin() {
  const L = S.login;
  if (!L) { loginDlg?.close(); loginDlg = null; return; }
  if (!loginDlg) {
    loginDlg = sheet(() => {});
    loginDlg.addEventListener('close', () => {
      const was = loginDlg; loginDlg = null;
      if (was && S.login && !['done', 'failed'].includes(S.login.status)) api('/api/login/cancel', {}).catch(() => {});
      else if (S.login) S.login = null;
    });
  }
  const d = loginDlg;
  d.replaceChildren();
  const id = `sheet-h${++sheetId}`;
  d.setAttribute('aria-labelledby', id);
  const cancel = btn(t('cancel'), () => d.close());
  if (L.status === 'done') {
    d.append(h('div', { class: 'stage' }, h('span', { class: 'big ok' }, icon('check')), h('h2', { id }, t('login_done'))));
  } else if (L.status === 'failed') {
    d.append(h('h2', { id }, t('login_failed')), h('p', { class: 'selectable' }, L.message || ''),
      actions(btn(t('close'), () => d.close()), btn(t('try_again'), guard(() => api('/api/accounts/login', { name: L.account })), 'primary')));
  } else if (L.status === 'need-code') {
    const input = h('input', { type: 'text', id: 'cd', autocomplete: 'off', spellcheck: 'false' });
    const send = guard(async () => { await api('/api/login/code', { code: input.value }); input.value = ''; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); } });
    d.append(h('h2', { id }, t('code_title')), h('p', {}, t('code_sub')), h('label', { class: 'field-label', for: 'cd' }, t('code_label')), input,
      actions(cancel, btn(t('submit'), send, 'primary')));
    setTimeout(() => input.focus(), 30);
  } else {
    const waiting = L.status === 'waiting';
    d.append(h('h2', { id }, t('login_title')),
      h('div', { class: 'stage' }, h('span', { class: 'spin' }), h('p', {}, waiting ? t('login_waiting', L.label) : t('login_starting'))),
      waiting && L.opened === 'default' ? h('p', { class: 'tip' }, t('login_tip')) : null,
      actions(cancel,
        waiting ? btn(t('open_again'), guard(() => api('/api/login/reopen', {}))) : null,
        waiting ? btn(t('copy_link'), () => navigator.clipboard?.writeText(L.url).then(() => toast(t('copied')))) : null));
  }
}

/* ---------- actions (delegated) ---------- */
const nameOf = (el) => acctOf(el.dataset.name);
const ACT = {
  tab: (el) => setTab(el.dataset.tab),
  settings: () => (S.view === 'settings' ? closeSettings() : openSettings()),
  back: () => closeSettings(),
  add: (el) => openAddDialog(el.dataset.email || ''),
  import: guard(() => api('/api/accounts/import-current', {})),
  leader: guard((el) => api('/api/accounts/desktop', { name: el.dataset.name })),
  signin: guard((el) => api('/api/accounts/login', { name: el.dataset.name })),
  refresh: guard(() => { const now = Date.now(); S.accounts.forEach((a) => { S.manual[a.name] = now; }); schedule(); return api('/api/usage/refresh', {}); }),
  intro: () => startIntro(),
  stop: guard((el) => api('/api/takeover/stop', { id: el.dataset.id })),
  model: (el) => { const a = nameOf(el); if (MENU?.anchor === el) closeMenu(true); else if (a) modelMenu(el, a); },
  more: (el) => { const a = nameOf(el); if (MENU?.anchor === el) closeMenu(true); else if (a) moreMenu(el, a); },
  'setup-autostart': () => { S.autoStart = !autoStartChoice(); render(); },
  connect: guard(async () => {
    if (S.canAutoStart && S.view !== 'settings') S.settings = await api('/api/settings', { startAtLogin: autoStartChoice() });
    S.connect = await api('/api/connect', {});
    render();
  }),
  disconnect: guard(async () => { S.connect = await api('/api/disconnect', {}); render(); }),
  autostart: guard(async () => { S.settings = await api('/api/settings', { startAtLogin: S.settings.startAtLogin === false }); render(); }),
  perm: guard(async (el) => {
    const before = S.settings;
    S.settings = { ...S.settings, permissionMode: el.dataset.mode };
    render();
    try { S.settings = await api('/api/settings', { permissionMode: el.dataset.mode }); } catch (e) { S.settings = before; render(); throw e; }
  }),
  lang: guard(async (el) => {
    const l = el.dataset.lang;
    if (l === LANG) return;
    const before = S.settings;
    S.settings = { ...S.settings, language: l };
    setLang(l);
    render();
    try { S.settings = await api('/api/settings', { language: l }); } catch (e) { S.settings = before; setLang(before.language); render(); throw e; }
  }),
  'remove-all': () => openRemoveAll(),
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || !el.closest('#app')) return;
  ACT[el.dataset.act]?.(el, e);
});
// Arrow keys inside tab lists and radio groups move the selection, as in native controls.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !MENU && !document.querySelector('dialog[open]') && S.view === 'settings') { e.preventDefault(); closeSettings(); return; }
  const el = e.target.closest && e.target.closest('[role="tab"], [role="radio"]');
  if (!el || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
  const group = el.closest('[role="tablist"], [role="radiogroup"]');
  const all = [...group.querySelectorAll(`[role="${el.getAttribute('role')}"]`)];
  const i = all.indexOf(el);
  const n = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1) + all.length) % all.length;
  e.preventDefault();
  const target = all[n];
  if (target.getAttribute('role') === 'tab') { setTab(target.dataset.tab, true); return; }
  target.click();
  target.focus();
});

/* ---------- boot ---------- */
function applyState(s) {
  Object.assign(S, {
    accounts: s.accounts, jobs: s.jobs, runs: s.runs || [], recent: s.recent || [], connect: s.connect, leader: s.leader, desktop: s.desktop || S.desktop,
    cli: s.cli || S.cli, settings: s.settings || {}, login: s.login, claudeProblem: s.claudeProblem, canAutoStart: s.canAutoStart,
  });
  setLang(S.settings.language);
}
const NOTICES = ['done', 'failed', 'needs-login', 'leader'];
async function boot() {
  applyState(await api('/api/state'));
  render();
  renderLogin();

  const es = new EventSource('/api/events');
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.type === 'jobs') { S.jobs = ev.jobs; if (ev.accounts) S.accounts = ev.accounts; }
    else if (ev.type === 'accounts') { S.accounts = ev.accounts; if (ev.leader !== undefined) S.leader = ev.leader; if (ev.desktop) S.desktop = ev.desktop; }
    else if (ev.type === 'usage') S.accounts = ev.accounts;
    else if (ev.type === 'runs') { S.runs = ev.runs; if (ev.recent) S.recent = ev.recent; if (ev.accounts) S.accounts = ev.accounts; }
    else if (ev.type === 'connect') S.connect = ev.connect;
    else if (ev.type === 'login') { S.login = ev.login; renderLogin(); return; }
    else if (ev.type === 'notify') {
      const n = ev.notice;
      if (NOTICES.includes(n.kind)) toast(t(`n_${n.kind.replace('-', '_')}`, { ...n, job: n.job && { ...n.job, account: n.job.account && labelOf(n.job.account) }, origin: n.origin ? labelOf(n.origin) : '', to: labelOf(n.to), account: labelOf(n.account) }));
      return;
    } else return;
    schedule(); // bursts of events become one render per frame
  };
  es.addEventListener('open', async () => { try { applyState(await api('/api/state')); schedule(); renderLogin(); } catch { /* server gone */ } });

  setInterval(() => {
    document.querySelectorAll('[data-cd]').forEach((el) => { el.textContent = fmtCountdown(Number(el.dataset.cd)); });
    document.querySelectorAll('[data-age]').forEach((el) => { el.textContent = fmtAge(Number(el.dataset.age)); });
  }, 1000);
  // accounts added from the terminal, recharge rings
  setInterval(async () => { try { applyState(await api('/api/state')); schedule(); } catch { /* server gone */ } }, 5000);
}
boot().catch((e) => { document.body.textContent = t('unreachable', e.message); });
