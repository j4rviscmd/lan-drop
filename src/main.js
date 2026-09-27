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
  $('url').textContent = info.url;
  $('qr').innerHTML = info.qr_svg;
  $('upload-dir').textContent = info.upload_dir;
  $('serve-root').textContent = info.serve_root;
  $('copy').addEventListener('click', () => {
    navigator.clipboard?.writeText(info.url);
  });

  const es = new EventSource(`http://127.0.0.1:${info.loopback_port}/api/events`);
  es.addEventListener('upload-progress', onProgress);
  es.addEventListener('upload-done', onDone);

  initUsb(info.upload_dir);
}

let usbUdid = null;
let usbCwd = [];
let usbUploadDir = '';

function usbStatus(msg) {
  $('usb-status').textContent = msg;
}

function usbRel() {
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
  sel.onchange = () => { usbUdid = sel.value; usbCwd = []; usbBrowse(); };
  await usbCheckPaired();
}

async function usbCheckPaired() {
  usbStatus('Checking pairing…');
  try {
    const info = await invoke('usb_device_info', { udid: usbUdid });
    usbStatus('Paired · ' + info.name + ' · iOS ' + info.version);
    $('usb-browser').hidden = false;
    usbCwd = [];
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
  root.onclick = (ev) => { ev.preventDefault(); usbCwd = []; usbBrowse(); };
  el.appendChild(root);
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
  let entries = [];
  try {
    entries = await invoke('usb_list', { udid: usbUdid, path: usbRel() });
  } catch (e) {
    usbStatus('Cannot browse: ' + e);
    return;
  }
  const ul = $('usb-entries');
  ul.innerHTML = '';
  for (const en of entries) {
    const li = document.createElement('li');
    li.className = 'entry' + (en.is_dir ? ' dir' : '');
    li.innerHTML =
      '<span class="icon"></span><span class="nm"></span><span class="meta"></span><span class="pull">⬇</span>';
    li.querySelector('.nm').textContent = en.name;
    li.querySelector('.icon').textContent = en.is_dir ? '📁' : '📄';
    li.querySelector('.meta').textContent = en.is_dir ? '' : fmtSize(en.size);
    if (en.is_dir) {
      li.onclick = () => { usbCwd.push(en.name); usbBrowse(); };
    } else {
      li.onclick = () => usbPull(en);
    }
    ul.appendChild(li);
  }
  if (entries.length === 0) {
    ul.innerHTML = '<li class="entry"><span class="meta" style="margin:auto">empty</span></li>';
  }
}

async function usbPull(en) {
  usbStatus('Pulling ' + en.name + '…');
  transferRow(en.name);
  try {
    const dest = await invoke('usb_pull', {
      udid: usbUdid,
      path: (usbRel() === '/' ? '' : usbRel()) + '/' + en.name,
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
    await invoke('usb_push', { udid: usbUdid, src: file, afcDir: '/lan-drop' });
    usbStatus('Sent to the phone (media partition, folder "lan-drop").');
  } catch (e) {
    usbStatus('Push failed: ' + e);
  }
}

async function initUsb(uploadDir) {
  usbUploadDir = uploadDir;
  $('usb-refresh').onclick = usbRefresh;
  $('usb-pair').onclick = usbPair;
  $('usb-push').onclick = usbPush;
  await usbRefresh();
 }

main();
