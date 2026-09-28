'use strict';

const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
const $ = (id) => document.getElementById(id);

function fmtSize(n) {
  if (n >= 1 << 30) return (n / (1 << 30)).toFixed(1) + ' GB';
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + ' MB';
  if (n >= 1 << 10) return (n / (1 << 10)).toFixed(1) + ' KB';
  return n + ' B';
}

function transferRow(file) {
  let row = document.querySelector('[data-file="' + CSS.escape(file) + '"]');
  if (!row) {
    $('empty').style.display = 'none';
    row = document.createElement('div');
    row.className = 'transfer';
    row.dataset.file = file;
    row.innerHTML =
      '<div class="row"><span class="nm"></span><span class="pct">…</span></div>' +
      '<div class="bar"><div></div></div>';
    row.querySelector('.nm').textContent = file;
    $('transfers').prepend(row);
  }
  return row;
}

function onProgress(e) {
  const d = JSON.parse(e.data);
  const row = transferRow(d.file);
  const pct = d.total ? Math.min(100, Math.round((d.received / d.total) * 100)) : 0;
  row.querySelector('.pct').textContent = pct + '%';
  row.querySelector('.bar > div').style.width = pct + '%';
}

function onDone(e) {
  const d = JSON.parse(e.data);
  const row = transferRow(d.file);
  row.classList.add('done');
  row.querySelector('.bar > div').style.width = '100%';
  row.querySelector('.pct').textContent = fmtSize(d.size);
}

async function main() {
  const info = await window.__TAURI__.core.invoke('server_info');
  $('status').textContent = 'Server running · port ' + info.port;
  $('upload-dir').textContent = info.upload_dir;

  const es = new EventSource(`http://127.0.0.1:${info.loopback_port}/api/events`);
  es.addEventListener('upload-progress', onProgress);
  es.addEventListener('upload-done', onDone);

  initUsb(info.upload_dir);
}

let usbUdid = null;
let usbCwd = [];
// null = app grid (initial view); {type:'media'}; {type:'app', id, name}
let usbScope = null;
// Apps that rejected house_arrest this session (iOS hides non-file-sharing apps).
const usbNoAccess = new Set();
let usbUploadDir = '';

// One outline icon family (stroke via CSS) — no emoji, no icon dependency.
const ICONS = {
  dir: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5"/></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m6 17 4-4 3 3 2-2 3 3"/></svg>',
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="m10 9.5 5 2.5-5 2.5Z"/></svg>',
  audio: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v11"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="15" r="2.5"/></svg>',
  dl: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10m0 0-4-4m4 4 4-4"/><path d="M5 20h14"/></svg>',
  chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="5" cy="6" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="18" r="1"/></svg>',
  app: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="4"/><circle cx="9.5" cy="10" r="1.2"/><circle cx="14.5" cy="10" r="1.2"/><circle cx="9.5" cy="14.5" r="1.2"/><circle cx="14.5" cy="14.5" r="1.2"/></svg>',
  media: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="17" cy="12" r="1.2"/><path d="M6.5 12h5"/></svg>',
};

// 'photo' = JPEG with a fetchable EXIF thumbnail; other images keep icons.
const FILE_KINDS = {
  jpg: 'photo', jpeg: 'photo',
  png: 'image', heic: 'image', heif: 'image', gif: 'image', webp: 'image', tif: 'image', tiff: 'image', bmp: 'image',
  mov: 'video', mp4: 'video', m4v: 'video', avi: 'video',
  mp3: 'audio', m4a: 'audio', aac: 'audio', wav: 'audio', caf: 'audio', aiff: 'audio',
};

function fileKind(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return FILE_KINDS[ext] || 'file';
}

// Why: only 'list' is persisted — grid is the default view, and any other
// stored value (or none) falls back to it.
let usbView = localStorage.getItem('usb-view') === 'list' ? 'list' : 'grid';
let usbThumbIo = null;

function usbPath(name) {
  return (usbRel() === '/' ? '' : usbRel()) + '/' + name;
}

function applyView() {
  $('usb-entries').className = 'entries ' + usbView;
  $('view-grid').setAttribute('aria-pressed', String(usbView === 'grid'));
  $('view-list').setAttribute('aria-pressed', String(usbView === 'list'));
  localStorage.setItem('usb-view', usbView);
}

function usbEntryEl(en) {
  const kind = en.is_dir ? 'dir' : fileKind(en.name);
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'entry' + (en.is_dir ? ' dir' : '');
  el.dataset.kind = kind;
  el.title = en.name;
  el.setAttribute('aria-label', en.name + (en.is_dir ? ', folder' : ', ' + fmtSize(en.size)));
  el.innerHTML =
    '<span class="thumb">' + (ICONS[kind] || ICONS.image) + '</span>' +
    '<span class="nm"></span><span class="meta"></span>' +
    '<span class="go">' + (en.is_dir ? ICONS.chev : ICONS.dl) + '</span>';
  el.querySelector('.nm').textContent = en.name;
  el.querySelector('.meta').textContent = en.is_dir ? '' : fmtSize(en.size);
  el.onclick = () => {
    if (en.is_dir) {
      usbCwd.push(en.name);
      usbBrowse();
    } else {
      usbPull(en);
    }
  };
  return el;
}

// Fetch EXIF thumbnails only for tiles that scrolled into view.
// ponytail: JPEG only — HEIC/MOV keep type icons until a decoder exists.
function loadThumbs(box) {
  usbThumbIo?.disconnect();
  usbThumbIo = new IntersectionObserver((visible) => {
    for (const v of visible) {
      if (!v.isIntersecting) continue;
      usbThumbIo.unobserve(v.target);
      const el = v.target;
      const name = el.querySelector('.nm').textContent;
      invoke('usb_thumbnail', {
        udid: usbUdid,
        path: usbPath(name),
        app: usbScope?.type === 'app' ? usbScope.id : null,
      })
        .then((url) => {
          if (!url) return;
          const img = document.createElement('img');
          img.alt = '';
          img.src = url;
          el.querySelector('.thumb').replaceChildren(img);
        })
        .catch(() => {}); // keep the type icon
    }
  }, { root: box });
  for (const el of box.querySelectorAll('.entry[data-kind="photo"]')) usbThumbIo.observe(el);
}

function usbStatus(msg) {
  $('usb-status').textContent = msg;
}

// VendDocuments roots the AFC session at the app container but only exposes
// the Documents subtree — so app-scope paths live under /Documents.
function usbRel() {
  if (usbScope?.type === 'app') {
    return '/Documents' + (usbCwd.length ? '/' + usbCwd.join('/') : '');
  }
  return '/' + usbCwd.join('/');
}

async function usbRefresh() {
  usbStatus('Looking for devices…');
  let devs = [];
  try {
    devs = await invoke('usb_devices');
  } catch (e) {
    usbStatus(String(e));
    return;
  }
  const sel = $('usb-devices');
  sel.innerHTML = '';
  for (const d of devs) {
    const opt = document.createElement('option');
    opt.value = d.udid;
    opt.textContent = d.udid + ' (' + d.connection + ')';
    sel.appendChild(opt);
  }
  if (devs.length === 0) {
    usbStatus('No iPhone found. Plug it in via USB (iTunes or the Apple Devices app must be installed), then Refresh.');
    $('usb-browser').hidden = true;
    return;
  }
  usbUdid = devs[0].udid;
  sel.onchange = () => { usbUdid = sel.value; usbCwd = []; usbScope = null; usbBrowse(); };
  await usbCheckPaired();
}

async function usbCheckPaired() {
  usbStatus('Checking pairing…');
  try {
    const info = await invoke('usb_device_info', { udid: usbUdid });
    usbStatus('Paired · ' + info.name + ' · iOS ' + info.version);
    $('usb-browser').hidden = false;
    usbCwd = [];
    usbScope = null;
    await usbBrowse();
  } catch {
    usbStatus('Not paired yet — press Pair, unlock the iPhone, then tap "Trust" on it.');
    $('usb-browser').hidden = true;
  }
}

async function usbPair() {
  usbStatus('Pairing… unlock the iPhone and tap "Trust" when it asks.');
  try {
    await invoke('usb_pair', { udid: usbUdid });
    usbStatus('Paired.');
    await usbCheckPaired();
  } catch (e) {
    usbStatus('Pairing failed: ' + e);
  }
}

function usbCrumbs() {
  const el = $('usb-crumbs');
  el.innerHTML = '';
  const root = document.createElement('a');
  root.textContent = 'iPhone';
  root.href = '#';
  root.onclick = (ev) => { ev.preventDefault(); usbCwd = []; usbScope = null; usbBrowse(); };
  el.appendChild(root);
  if (usbScope) {
    el.append(' / ');
    const scopeName = usbScope.type === 'app' ? usbScope.name : 'Media';
    if (usbCwd.length === 0) {
      el.append(scopeName);
    } else {
      const a = document.createElement('a');
      a.textContent = scopeName;
      a.href = '#';
      a.onclick = (ev) => { ev.preventDefault(); usbCwd = []; usbBrowse(); };
      el.appendChild(a);
    }
  }
  usbCwd.forEach((seg, i) => {
    el.append(' / ');
    if (i + 1 < usbCwd.length) {
      const a = document.createElement('a');
      a.textContent = seg;
      a.href = '#';
      a.onclick = (ev) => { ev.preventDefault(); usbCwd = usbCwd.slice(0, i + 1); usbBrowse(); };
      el.appendChild(a);
    } else {
      el.append(seg);
    }
  });
}

async function usbBrowse() {
  usbCrumbs();
  const box = $('usb-entries');
  box.innerHTML = '';
  usbThumbIo?.disconnect();
  if (!usbScope) {
    await usbAppsView(box);
    return;
  }
  let entries = [];
  try {
    entries = await invoke('usb_list', {
      udid: usbUdid,
      path: usbRel(),
      app: usbScope.type === 'app' ? usbScope.id : null,
    });
  } catch (e) {
    // Fresh installs may not have a Documents folder yet.
    if (usbScope?.type === 'app' && usbCwd.length === 0 &&
        /not found|no such/i.test(String(e))) {
      box.innerHTML = '<p class="empty">Nothing here</p>';
      usbStatus(usbScope.name + ' has no shared Documents yet.');
      return;
    }
    // iOS reports non-file-sharing apps to house_arrest as InstallationLookupFailed.
    if (usbScope?.type === 'app' && String(e).includes('InstallationLookupFailed')) {
      const name = usbScope.name;
      usbNoAccess.add(usbScope.id);
      usbScope = null;
      usbCwd = [];
      usbCrumbs();
      await usbAppsView(box);
      usbStatus(name + " doesn't allow file access — iOS only exposes file-sharing apps.");
      return;
    }
    usbStatus('Cannot browse: ' + e);
    return;
  }
  for (const en of entries) {
    box.appendChild(usbEntryEl(en));
  }
  if (entries.length === 0) {
    box.innerHTML = '<p class="empty">Nothing here</p>';
    return;
  }
  loadThumbs(box);
}

/// Tile that switches the browse scope (an app container or the media partition).
function scopeTile(name, icon, kind, onOpen) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'entry dir';
  el.dataset.kind = kind;
  el.title = name;
  el.setAttribute('aria-label', name + ', folder');
  el.innerHTML =
    '<span class="thumb">' + icon + '</span><span class="nm"></span><span class="meta"></span>' +
    '<span class="go">' + ICONS.chev + '</span>';
  el.querySelector('.nm').textContent = name;
  el.onclick = onOpen;
  return el;
}

async function usbAppsView(box) {
  let apps = [];
  try {
    apps = await invoke('usb_apps', { udid: usbUdid });
  } catch (e) {
    usbStatus('Cannot list apps: ' + e);
    return;
  }
  for (const a of apps) {
    const tile = scopeTile(a.name, ICONS.app, 'app', () => {
      if (usbNoAccess.has(a.bundle_id)) {
        usbStatus(a.name + " doesn't allow file access — iOS only exposes file-sharing apps.");
        return;
      }
      usbScope = { type: 'app', id: a.bundle_id, name: a.name };
      usbCwd = [];
      usbBrowse();
    });
    if (usbNoAccess.has(a.bundle_id)) tile.classList.add('noaccess');
    box.appendChild(tile);
  }
// Why: apps are the initial view per design; the media partition is the
// fallback/legacy target, so its tile goes last.
  box.appendChild(scopeTile('Media partition', ICONS.media, 'media', () => {
    usbScope = { type: 'media' };
    usbCwd = [];
    usbBrowse();
  }));
  if (apps.length === 0) {
    box.innerHTML = '<p class="empty">No user-installed apps</p>';
  }
}

async function usbPull(en) {
  usbStatus('Pulling ' + en.name + '…');
  transferRow(en.name);
  try {
    const dest = await invoke('usb_pull', {
      udid: usbUdid,
      path: usbPath(en.name),
      app: usbScope?.type === 'app' ? usbScope.id : null,
      destDir: usbUploadDir,
    });
    usbStatus('Saved to ' + dest);
  } catch (e) {
    usbStatus('Pull failed: ' + e);
  }
}

async function usbPush() {
  const file = await window.__TAURI__.dialog.open({ multiple: false });
  if (!file) return;
  usbStatus('Sending ' + file + '…');
  transferRow(String(file).split(/[\\/]/).pop());
  try {
    const inApp = usbScope?.type === 'app';
    await invoke('usb_push', {
      udid: usbUdid,
      src: file,
      afcDir: inApp ? '/Documents' : '/lan-drop',
      app: inApp ? usbScope.id : null,
    });
    usbStatus(inApp
      ? 'Sent into ' + usbScope.name + ' (Documents).'
      : 'Sent to the phone (media partition, folder "lan-drop").');
  } catch (e) {
    usbStatus('Push failed: ' + e);
  }
}

async function initUsb(uploadDir) {
  usbUploadDir = uploadDir;
  $('usb-refresh').onclick = usbRefresh;
  $('usb-pair').onclick = usbPair;
  $('usb-push').onclick = usbPush;
  $('view-grid').innerHTML = ICONS.grid;
  $('view-list').innerHTML = ICONS.list;
  $('view-grid').onclick = () => { usbView = 'grid'; applyView(); };
  $('view-list').onclick = () => { usbView = 'list'; applyView(); };
  applyView();
  await usbRefresh();
 }

main();
