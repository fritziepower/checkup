/* checkup ♡ — daily weigh-in tracker. All data stays on the device (IndexedDB). */
(() => {
  'use strict';

  // ---------- tiny helpers ----------
  const $ = (id) => document.getElementById(id);
  const KG_TO_LB = 2.20462;
  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => toISO(new Date());
  const addDays = (iso, n) => { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
  const dayDiff = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 86400000);
  const shortDate = (iso) => { const d = fromISO(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const niceDate = (iso) => fromISO(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  const store = {
    get(k, def) { try { const v = localStorage.getItem('checkup.' + k); return v === null ? def : JSON.parse(v); } catch { return def; } },
    set(k, v) { try { localStorage.setItem('checkup.' + k, JSON.stringify(v)); } catch { /* private mode */ } }
  };

  const settings = {
    name: store.get('name', 'babe'),
    units: store.get('units', 'kg'),
    goal: store.get('goal', null) // stored in kg
  };
  const toDisp = (kg) => (settings.units === 'lb' ? kg * KG_TO_LB : kg);
  const fromDisp = (v) => (settings.units === 'lb' ? v / KG_TO_LB : v);
  const fmtW = (kg) => toDisp(kg).toFixed(1);

  // ---------- IndexedDB ----------
  let dbp;
  function db() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const r = indexedDB.open('checkup', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('entries', { keyPath: 'date' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('entries', mode);
      const s = t.objectStore('entries');
      let out;
      const r = fn(s);
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  const dbAll = () => tx('readonly', (s) => s.getAll());
  const dbPut = (e) => tx('readwrite', (s) => s.put(e));
  const dbDel = (k) => tx('readwrite', (s) => s.delete(k));
  const dbClear = () => tx('readwrite', (s) => s.clear());

  // ---------- state ----------
  let entries = []; // sorted ascending by date
  let range = store.get('range', 30);
  let pendingPhoto; // undefined = unchanged, null = removed, Blob = new
  const urlCache = new Map();
  const photoURL = (e) => {
    if (!e || !e.photo) return null;
    const key = e.date + ':' + (e.updated || 0);
    if (!urlCache.has(key)) urlCache.set(key, URL.createObjectURL(e.photo));
    return urlCache.get(key);
  };
  const byDate = (iso) => entries.find((e) => e.date === iso);

  async function reload() {
    entries = (await dbAll()).sort((a, b) => (a.date < b.date ? -1 : 1));
    renderAll();
  }

  // ---------- form ----------
  const el = {
    date: $('date'), weight: $('weight'), period: $('togPeriod'), poop: $('togPoop'),
    thumb: $('thumb'), msg: $('msg'), removePhoto: $('btnRemovePhoto')
  };
  const setTog = (b, on) => b.setAttribute('aria-pressed', on ? 'true' : 'false');
  const getTog = (b) => b.getAttribute('aria-pressed') === 'true';
  [el.period, el.poop].forEach((b) => b.addEventListener('click', () => { setTog(b, !getTog(b)); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }));

  function loadForm(iso) {
    el.date.value = iso;
    el.date.max = todayISO();
    const e = byDate(iso);
    pendingPhoto = undefined;
    el.weight.value = e && e.weight != null ? fmtW(e.weight) : '';
    setTog(el.period, e ? e.period : guessPeriod(iso));
    setTog(el.poop, e ? e.pooped : false);
    showThumb(e && e.photo ? photoURL(e) : null);
    el.msg.textContent = e ? '✎ editing ' + niceDate(iso) : '';
  }
  // If yesterday was a period day, pre-tick today (cycle usually continues).
  function guessPeriod(iso) { const y = byDate(addDays(iso, -1)); return !!(y && y.period); }

  function showThumb(url) {
    el.thumb.innerHTML = url ? `<img src="${url}" alt="today's photo">` : '<span>no pic yet ✧</span>';
    el.removePhoto.classList.toggle('hidden', !url);
  }
  el.date.addEventListener('change', () => { if (el.date.value) loadForm(el.date.value); });
  el.removePhoto.addEventListener('click', () => { pendingPhoto = null; showThumb(null); });

  function setPhoto(blob) {
    pendingPhoto = blob;
    showThumb(URL.createObjectURL(blob));
    say('pic ready ✧ tap save!');
  }

  $('btnSave').addEventListener('click', async () => {
    const iso = el.date.value || todayISO();
    const raw = el.weight.value.trim().replace(',', '.');
    const prev = byDate(iso);
    let weight = raw === '' ? null : parseFloat(raw);
    if (weight !== null && (!isFinite(weight) || weight <= 0 || weight > 1000)) { say('hmm that number looks weird (｡•́︿•̀｡)'); return; }
    if (weight !== null) weight = fromDisp(weight);
    // keep the precise stored value if the user didn't change the displayed number
    if (prev && prev.weight != null && weight !== null && fmtW(prev.weight) === toDisp(weight).toFixed(1)) weight = prev.weight;
    const photo = pendingPhoto === undefined ? (prev ? prev.photo : null) : pendingPhoto;
    if (weight === null && !photo && !getTog(el.period) && !getTog(el.poop)) { say('type your weight first ♡'); el.weight.focus(); return; }
    const entry = { date: iso, weight, period: getTog(el.period), pooped: getTog(el.poop), photo: photo || null, updated: Date.now() };
    try {
      await dbPut(entry);
    } catch (err) {
      say('could not save :( ' + (err && err.message ? err.message : ''));
      return;
    }
    await reload();
    loadForm(iso);
    say(cheer(iso));
    hearts();
  });

  function cheer(iso) {
    const lines = ['saved ♡ you did it!', 'logged ✧ proud of u', 'entry saved (˶ᵔ ᵕ ᵔ˶)', 'saved! hydrate, queen 💧', 'saved ♡ one day at a time', 'beep boop saved ✧'];
    const s = streak();
    if (iso === todayISO() && s > 1) return `saved ♡ ${s}-day streak! 🔥`;
    return lines[Math.floor(Math.random() * lines.length)];
  }
  let msgT;
  function say(t) { el.msg.textContent = t; clearTimeout(msgT); msgT = setTimeout(() => { if (el.msg.textContent === t) el.msg.textContent = ''; }, 4000); }

  function hearts() {
    for (let i = 0; i < 14; i++) {
      const h = document.createElement('span');
      h.textContent = ['♥', '✧', '♡', '★'][i % 4];
      Object.assign(h.style, {
        position: 'fixed', left: 50 + (Math.random() * 60 - 30) + 'vw', top: '60vh', zIndex: 60, pointerEvents: 'none',
        color: ['#ff5c96', '#c8a0ff', '#8cdcbe', '#ffcc4d'][i % 4], fontSize: 18 + Math.random() * 18 + 'px',
        transition: 'transform 1.1s cubic-bezier(.2,.8,.3,1), opacity 1.1s', fontFamily: 'Term'
      });
      document.body.appendChild(h);
      requestAnimationFrame(() => {
        h.style.transform = `translate(${Math.random() * 200 - 100}px, ${-150 - Math.random() * 250}px) rotate(${Math.random() * 90 - 45}deg)`;
        h.style.opacity = '0';
      });
      setTimeout(() => h.remove(), 1200);
    }
  }

  // ---------- image processing ----------
  const MAX_W = 1080, MAX_H = 1440;
  function canvasToBlob(c) {
    return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.85));
  }
  async function fileToBlob(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const s = Math.min(1, MAX_W / img.naturalWidth, MAX_H / img.naturalHeight, Math.max(MAX_W, MAX_H) / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return await canvasToBlob(c);
    } finally { URL.revokeObjectURL(url); }
  }
  async function onFile(input) {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    try { setPhoto(await fileToBlob(f)); } catch { say("couldn't read that pic :("); }
  }
  $('fileGallery').addEventListener('change', (e) => onFile(e.target));
  $('fileCapture').addEventListener('change', (e) => onFile(e.target));
  $('btnGallery').addEventListener('click', () => $('fileGallery').click());

  // ---------- camera ----------
  const cam = { stream: null, facing: store.get('facing', 'user'), timer: 0, ghost: store.get('ghost', true) };
  const video = $('video');
  const ghostImg = $('ghost');

  $('btnCamera').addEventListener('click', openCamera);
  async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('fileCapture').click(); return; }
    $('camOverlay').classList.remove('hidden');
    // ghost = most recent earlier photo, to line up your pose
    const iso = el.date.value || todayISO();
    const prev = [...entries].reverse().find((e) => e.photo && e.date < iso) || [...entries].reverse().find((e) => e.photo && e.date !== iso);
    if (prev) ghostImg.src = photoURL(prev);
    updateCamButtons(!!prev);
    try {
      await startStream();
    } catch (err) {
      closeCamera();
      // fall back to the native camera sheet
      $('fileCapture').setAttribute('capture', cam.facing === 'user' ? 'user' : 'environment');
      $('fileCapture').click();
    }
  }
  async function startStream() {
    stopStream();
    cam.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: cam.facing, width: { ideal: 1440 }, height: { ideal: 1920 } }, audio: false
    });
    video.srcObject = cam.stream;
    video.classList.toggle('mirror', cam.facing === 'user');
    ghostImg.style.transform = '';
    await video.play().catch(() => {});
  }
  function stopStream() { if (cam.stream) { cam.stream.getTracks().forEach((t) => t.stop()); cam.stream = null; } }
  function closeCamera() { stopStream(); video.srcObject = null; $('camOverlay').classList.add('hidden'); $('countdown').classList.add('hidden'); }
  function updateCamButtons(hasGhost) {
    $('camTimer').textContent = '⏱ ' + (cam.timer ? cam.timer + 's' : 'off');
    $('camGhost').classList.toggle('hidden', !hasGhost);
    $('camGhost').textContent = cam.ghost ? '👻 ghost on' : '👻 ghost off';
    ghostImg.classList.toggle('hidden', !(hasGhost && cam.ghost));
  }
  $('camClose').addEventListener('click', closeCamera);
  $('camFlip').addEventListener('click', async () => {
    cam.facing = cam.facing === 'user' ? 'environment' : 'user'; store.set('facing', cam.facing);
    try { await startStream(); } catch { say("couldn't switch camera"); }
  });
  $('camTimer').addEventListener('click', () => { cam.timer = cam.timer === 0 ? 3 : cam.timer === 3 ? 10 : 0; updateCamButtons(!!ghostImg.getAttribute('src')); });
  $('camGhost').addEventListener('click', () => { cam.ghost = !cam.ghost; store.set('ghost', cam.ghost); updateCamButtons(true); });

  let shooting = false;
  $('camShutter').addEventListener('click', async () => {
    if (shooting || !cam.stream) return;
    shooting = true;
    const cd = $('countdown');
    for (let n = cam.timer; n > 0; n--) {
      cd.textContent = n; cd.classList.remove('hidden');
      await new Promise((r) => setTimeout(r, 1000));
    }
    cd.classList.add('hidden');
    const f = document.createElement('div'); f.className = 'flash'; document.body.appendChild(f); setTimeout(() => f.remove(), 400);
    try {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw) throw new Error('no frame');
      // crop to 3:4 portrait like the viewfinder (object-fit: cover)
      const target = 3 / 4;
      let sw = vw, sh = vh;
      if (vw / vh > target) sw = vh * target; else sh = vw / target;
      const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
      const s = Math.min(1, MAX_W / sw);
      const c = document.createElement('canvas');
      c.width = Math.round(sw * s); c.height = Math.round(sh * s);
      const ctx = c.getContext('2d');
      if (cam.facing === 'user') { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
      const blob = await canvasToBlob(c);
      closeCamera();
      setPhoto(blob);
    } catch {
      say('oops, camera hiccup. try again?');
    } finally { shooting = false; }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && cam.stream) closeCamera(); });

  // ---------- stats ----------
  function streak() {
    let n = 0, d = todayISO();
    if (!byDate(d)) d = addDays(d, -1); // today not logged yet doesn't break the streak
    while (byDate(d) && byDate(d).weight != null) { n++; d = addDays(d, -1); }
    return n;
  }
  function renderStats() {
    const w = entries.filter((e) => e.weight != null);
    const last = w[w.length - 1];
    const first = w[0];
    const weekAgo = [...w].reverse().find((e) => last && dayDiff(e.date, last.date) >= 7);
    const u = settings.units;
    const delta = (a, b) => { if (!a || !b) return null; return toDisp(b.weight) - toDisp(a.weight); };
    const fmtD = (d) => (d === null ? '—' : (d > 0 ? '+' : '') + d.toFixed(1));
    const dWeek = delta(weekAgo, last), dAll = delta(first, last);
    const cards = [
      ['latest', last ? `${fmtW(last.weight)}${u}` : '—', ''],
      ['vs 1wk', fmtD(dWeek), dWeek !== null && dWeek < 0 ? 'down' : ''],
      ['total', fmtD(dAll), dAll !== null && dAll < 0 ? 'down' : ''],
      ['streak', `${streak()}🔥`, ''],
      ['entries', String(entries.length), ''],
      settings.goal ? ['to goal', last ? (toDisp(last.weight) - toDisp(settings.goal)).toFixed(1) : '—', ''] : ['pics', String(entries.filter((e) => e.photo).length), '']
    ];
    $('stats').innerHTML = cards.map(([k, v, c]) => `<div class="stat ${c}"><span>${k}</span><b>${v}</b></div>`).join('');
  }

  // ---------- chart ----------
  const canvas = $('chart');
  const tip = document.createElement('p');
  tip.className = 'note'; tip.style.margin = '6px 0 0'; tip.style.minHeight = '1.2em';
  canvas.parentNode.after(tip);
  let chartPts = [];

  document.querySelectorAll('#range button').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.r) === range);
    b.addEventListener('click', () => {
      range = Number(b.dataset.r); store.set('range', range);
      document.querySelectorAll('#range button').forEach((x) => x.classList.toggle('on', x === b));
      tip.textContent = '';
      drawChart();
    });
  });

  function drawChart() {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 300, H = 220;
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const end = todayISO();
    const all = entries.filter((e) => e.weight != null);
    let start = range ? addDays(end, -(range - 1)) : (all[0] ? all[0].date : end);
    if (!range && dayDiff(start, end) < 6) start = addDays(end, -6);
    const data = all.filter((e) => e.date >= start && e.date <= end);
    const periods = entries.filter((e) => e.period && e.date >= start && e.date <= end);

    const L = 46, R = 12, T = 24, B = 30;
    const pw = W - L - R, ph = H - T - B;
    const span = Math.max(1, dayDiff(start, end));
    const xOf = (iso) => L + (dayDiff(start, iso) / span) * pw;

    ctx.font = '9px Px, monospace';
    ctx.textBaseline = 'middle';

    if (!data.length) {
      ctx.fillStyle = '#b0739a'; ctx.textAlign = 'center';
      ctx.font = '22px Term, monospace';
      ctx.fillText('no data yet ~ log ur first weigh-in ♡', W / 2, H / 2);
      chartPts = [];
      return;
    }

    const vals = data.map((e) => toDisp(e.weight));
    if (settings.goal) vals.push(toDisp(settings.goal));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const padV = Math.max(0.5, (hi - lo) * 0.15);
    lo -= padV; hi += padV;
    const yOf = (v) => T + (1 - (v - lo) / (hi - lo)) * ph;

    // period columns (soft background)
    const colW = Math.max(3, pw / (span + 1));
    ctx.fillStyle = 'rgba(255, 59, 92, 0.10)';
    periods.forEach((e) => ctx.fillRect(xOf(e.date) - colW / 2, T, colW, ph));
    // period ribbon under the axis
    ctx.fillStyle = '#ff3b5c';
    periods.forEach((e) => ctx.fillRect(xOf(e.date) - colW / 2, T + ph + 3, colW, 4));

    // grid
    ctx.fillStyle = '#e9a6c8';
    const steps = 4;
    ctx.textAlign = 'right';
    for (let i = 0; i <= steps; i++) {
      const v = lo + ((hi - lo) * i) / steps;
      const y = Math.round(yOf(v));
      for (let x = L; x < W - R; x += 6) ctx.fillRect(x, y, 2, 1);
      ctx.fillStyle = '#b0739a';
      ctx.fillText(v.toFixed(1), L - 6, y);
      ctx.fillStyle = '#e9a6c8';
    }
    // x labels
    ctx.textAlign = 'center'; ctx.fillStyle = '#b0739a';
    const nLab = Math.min(span, W < 360 ? 3 : 5);
    for (let i = 0; i <= nLab; i++) {
      const iso = addDays(start, Math.round((span * i) / nLab));
      ctx.textAlign = i === 0 ? 'left' : i === nLab ? 'right' : 'center';
      ctx.fillText(shortDate(iso), i === 0 ? L - 4 : i === nLab ? W - R + 4 : xOf(iso), H - 10);
    }

    // goal line
    if (settings.goal) {
      const gy = Math.round(yOf(toDisp(settings.goal)));
      ctx.fillStyle = '#3aa982';
      for (let x = L; x < W - R; x += 10) ctx.fillRect(x, gy, 6, 2);
      ctx.textAlign = 'left'; ctx.fillText('goal', L + 4, gy - 8);
    }

    // line — segments turn red on period days
    const pts = data.map((e) => ({ x: xOf(e.date), y: yOf(toDisp(e.weight)), e }));
    chartPts = pts;
    const LINE = '#b77ee8', RED = '#ff3b5c';
    ctx.lineWidth = 3; ctx.lineCap = 'square'; ctx.lineJoin = 'miter';
    const seg = (a, b, col) => { ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const ca = a.e.period ? RED : LINE, cb = b.e.period ? RED : LINE;
      if (ca === cb) seg(a, b, ca);
      else { const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; seg(a, m, ca); seg(m, b, cb); }
    }
    // points + asterisks
    pts.forEach((p) => {
      ctx.fillStyle = '#7a3e62';
      ctx.fillRect(Math.round(p.x) - 4, Math.round(p.y) - 4, 8, 8);
      ctx.fillStyle = p.e.period ? RED : '#ff9cc8';
      ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 4, 4);
      if (p.e.pooped) {
        ctx.fillStyle = '#c58b00'; ctx.textAlign = 'center';
        ctx.font = '12px Px, monospace';
        ctx.fillText('*', p.x, p.y - 13);
        ctx.font = '9px Px, monospace';
      }
    });
  }

  function chartTap(ev) {
    if (!chartPts.length) return;
    const r = canvas.getBoundingClientRect();
    const t = ev.touches ? ev.touches[0] : ev;
    const x = t.clientX - r.left;
    let best = chartPts[0];
    chartPts.forEach((p) => { if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p; });
    const e = best.e;
    tip.textContent = `▸ ${niceDate(e.date)} · ${fmtW(e.weight)}${settings.units}${e.period ? ' · 🩸' : ''}${e.pooped ? ' · 💩' : ''}`;
  }
  canvas.addEventListener('click', chartTap);
  canvas.addEventListener('touchmove', (e) => { chartTap(e); }, { passive: true });
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(drawChart, 150); });

  // ---------- gallery + viewer ----------
  let viewList = [], viewIdx = 0;
  function renderGallery() {
    viewList = entries.filter((e) => e.photo).reverse();
    const g = $('gallery');
    if (!viewList.length) { g.innerHTML = '<p class="empty">no progress pics yet. snap one! 📸</p>'; return; }
    g.innerHTML = viewList.map((e, i) => `<button data-i="${i}"><img loading="lazy" src="${photoURL(e)}" alt="photo ${e.date}"><small>${shortDate(e.date)}</small></button>`).join('');
  }
  $('gallery').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-i]'); if (b) openViewer(Number(b.dataset.i)); });
  function openViewer(i) {
    viewIdx = Math.max(0, Math.min(viewList.length - 1, i));
    const e = viewList[viewIdx];
    $('viewerImg').src = photoURL(e);
    $('viewerTitle').textContent = e.date + '.jpg';
    $('viewerInfo').textContent = `${niceDate(e.date)}${e.weight != null ? ' · ' + fmtW(e.weight) + settings.units : ''}`;
    $('viewerPrev').disabled = viewIdx >= viewList.length - 1;
    $('viewerNext').disabled = viewIdx <= 0;
    $('viewer').classList.remove('hidden');
  }
  $('viewerClose').addEventListener('click', () => $('viewer').classList.add('hidden'));
  $('viewerPrev').addEventListener('click', () => openViewer(viewIdx + 1)); // older
  $('viewerNext').addEventListener('click', () => openViewer(viewIdx - 1)); // newer
  let sx0 = null;
  $('viewerImg').addEventListener('touchstart', (e) => { sx0 = e.touches[0].clientX; }, { passive: true });
  $('viewerImg').addEventListener('touchend', (e) => {
    if (sx0 === null) return;
    const dx = e.changedTouches[0].clientX - sx0; sx0 = null;
    if (Math.abs(dx) > 40) openViewer(viewIdx + (dx > 0 ? 1 : -1));
  });

  // ---------- history ----------
  function renderHistory() {
    const h = $('history');
    if (!entries.length) { h.innerHTML = '<li class="empty">empty log. today is day one ♡</li>'; return; }
    h.innerHTML = [...entries].reverse().map((e) => `
      <li>
        <span class="d">${shortDate(e.date)} ${fromISO(e.date).toLocaleDateString(undefined, { weekday: 'short' }).toLowerCase()}</span>
        <span class="w">${e.weight != null ? fmtW(e.weight) + settings.units : '—'}</span>
        <span class="f">${e.period ? '🩸' : ''}${e.pooped ? '<b class="ast">*</b>' : ''}${e.photo ? '📷' : ''}</span>
        <button data-edit="${e.date}" aria-label="edit">✎</button>
        <button data-del="${e.date}" aria-label="delete">✕</button>
      </li>`).join('');
  }
  $('history').addEventListener('click', async (ev) => {
    const ed = ev.target.closest('[data-edit]'), del = ev.target.closest('[data-del]');
    if (ed) { loadForm(ed.dataset.edit); $('logCard').scrollIntoView({ behavior: 'smooth' }); }
    if (del && confirm(`delete entry for ${niceDate(del.dataset.del)}?`)) {
      await dbDel(del.dataset.del); await reload();
      if (el.date.value === del.dataset.del) loadForm(del.dataset.del);
    }
  });

  // ---------- settings ----------
  function applyUnitsLabel() {
    $('unitLbl').textContent = settings.units;
    document.querySelectorAll('#setUnits button').forEach((b) => b.classList.toggle('on', b.dataset.u === settings.units));
    $('setGoal').value = settings.goal ? fmtW(settings.goal) : '';
  }
  $('btnSettings').addEventListener('click', async () => {
    $('setName').value = settings.name;
    applyUnitsLabel();
    $('settings').classList.remove('hidden');
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        $('storageInfo').textContent = `storage used: ${(est.usage / 1048576).toFixed(1)} MB${persisted ? ' · protected ✓' : ''}`;
      }
    } catch { /* ignore */ }
  });
  $('settingsClose').addEventListener('click', () => {
    settings.name = ($('setName').value.trim() || 'babe').slice(0, 16);
    store.set('name', settings.name);
    const g = parseFloat(String($('setGoal').value).replace(',', '.'));
    settings.goal = isFinite(g) && g > 0 ? fromDisp(g) : null;
    store.set('goal', settings.goal);
    $('settings').classList.add('hidden');
    document.querySelector('.prompt .u').textContent = settings.name;
    renderAll();
    loadForm(el.date.value || todayISO());
  });
  document.querySelectorAll('#setUnits button').forEach((b) => b.addEventListener('click', () => {
    // convert typed goal into the new unit before switching
    const g = parseFloat(String($('setGoal').value).replace(',', '.'));
    const gkg = isFinite(g) && g > 0 ? fromDisp(g) : null;
    settings.units = b.dataset.u; store.set('units', settings.units);
    settings.goal = gkg;
    applyUnitsLabel();
  }));

  const blobToDataURL = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
  const dataURLToBlob = async (u) => (await fetch(u)).blob();

  $('btnExport').addEventListener('click', async () => {
    const out = [];
    for (const e of entries) out.push({ ...e, photo: e.photo ? await blobToDataURL(e.photo) : null });
    const json = JSON.stringify({ app: 'checkup', version: 1, exported: new Date().toISOString(), settings, entries: out });
    const file = new File([json], `checkup-backup-${todayISO()}.json`, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'checkup backup' }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  $('btnImport').addEventListener('click', () => $('fileImport').click());
  $('fileImport').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || !Array.isArray(data.entries)) throw new Error('not a checkup backup');
      if (!confirm(`import ${data.entries.length} entries? (same dates get replaced)`)) return;
      for (const e of data.entries) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue;
        await dbPut({
          date: e.date, weight: typeof e.weight === 'number' ? e.weight : null, period: !!e.period, pooped: !!e.pooped,
          photo: typeof e.photo === 'string' && e.photo.startsWith('data:image/') ? await dataURLToBlob(e.photo) : null,
          updated: Date.now()
        });
      }
      await reload(); loadForm(el.date.value || todayISO());
      alert('imported ♡');
    } catch (err) { alert('import failed: ' + err.message); }
  });
  $('btnWipe').addEventListener('click', async () => {
    if (!confirm('delete ALL entries and photos? this cannot be undone')) return;
    if (!confirm('really really? (export a backup first!)')) return;
    await dbClear(); await reload(); loadForm(todayISO());
  });

  // ---------- render ----------
  function renderAll() { renderStats(); drawChart(); renderGallery(); renderHistory(); }

  // ---------- boot ----------
  function boot() {
    const h = new Date().getHours();
    const greet = h < 5 ? 'up late' : h < 12 ? 'good morning' : h < 18 ? 'good afternoon' : 'good evening';
    const done = !!byDate(todayISO());
    const lines = [`> booting checkup.sh ♡ ... ok`, `> ${greet}, ${settings.name}! ${done ? 'today is logged ✓' : 'time to weigh in ✧'}`];
    const p = $('boot');
    let li = 0, ci = 0;
    p.textContent = '';
    const tick = () => {
      if (li >= lines.length) return;
      p.textContent += lines[li][ci++] || '';
      if (ci > lines[li].length) { li++; ci = 0; if (li < lines.length) p.textContent += '\n'; }
      setTimeout(tick, 22);
    };
    tick();
  }

  function sparkles() {
    const s = document.querySelector('.sparkles');
    for (let i = 0; i < 14; i++) {
      const e = document.createElement('span');
      e.textContent = ['✦', '♡', '✧', '·', '★'][i % 5];
      e.style.left = Math.random() * 100 + 'vw';
      e.style.animationDelay = -Math.random() * 9 + 's';
      e.style.animationDuration = 8 + Math.random() * 8 + 's';
      e.style.fontSize = 8 + Math.random() * 10 + 'px';
      s.appendChild(e);
    }
  }

  function installHint() {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    if (ios && !standalone && !store.get('hintDismissed', false)) $('installHint').classList.remove('hidden');
    $('installClose').addEventListener('click', () => { $('installHint').classList.add('hidden'); store.set('hintDismissed', true); });
  }

  async function init() {
    document.querySelector('.prompt .u').textContent = settings.name;
    applyUnitsLabel();
    sparkles();
    installHint();
    try { await reload(); } catch (e) { say('storage unavailable :( ' + e.message); }
    loadForm(todayISO());
    boot();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawChart);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
    // new day while the app sat open in the background
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && el.date.max !== todayISO()) { loadForm(todayISO()); renderAll(); boot(); }
    });
  }
  init();
})();
