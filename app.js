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
    goal: store.get('goal', null), // stored in kg
    theme: store.get('theme', 'pink'),
    pet: store.get('pet', 'mochi')
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
    if (iso === todayISO() && s > 0 && s % 7 === 0) return `✧ ${s}-day streak! new sticker unlocked ✧`;
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
  // Uses the iPhone's own camera sheet (photo mode): no permission pop-ups,
  // no live-video "recording" indicator, no timer.
  $('btnCamera').addEventListener('click', () => $('fileCapture').click());

  // ---------- weight input: accept 72,4 or 72.4 ----------
  function cleanDecimal(inp) {
    inp.addEventListener('input', () => {
      let v = inp.value.replace(',', '.').replace(/[^0-9.]/g, '');
      const i = v.indexOf('.');
      if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '').slice(0, 1);
      if (v !== inp.value) inp.value = v;
    });
  }
  cleanDecimal(el.weight);
  cleanDecimal($('setGoal'));
  el.weight.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.weight.blur(); });

  // ---------- derived data: trend + cycle ----------
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const cssVar = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
  let trend = new Map(); // date -> 7-day rolling average (kg)
  let cyc = null;

  function computeTrend() {
    const w = entries.filter((e) => e.weight != null);
    const m = new Map();
    let j = 0, sum = 0;
    for (let i = 0; i < w.length; i++) {
      sum += w[i].weight;
      while (dayDiff(w[j].date, w[i].date) > 6) { sum -= w[j].weight; j++; }
      m.set(w[i].date, sum / (i - j + 1));
    }
    return m;
  }
  const weightsBetween = (a, b) => entries.filter((e) => e.weight != null && e.date >= a && e.date <= b).map((e) => e.weight);

  function computeCycle() {
    const today = todayISO();
    const periods = [];
    entries.filter((e) => e.period).forEach((e) => {
      const last = periods[periods.length - 1];
      if (last && dayDiff(last.end, e.date) <= 2) last.end = e.date; // a missed log inside a period doesn't split it
      else periods.push({ start: e.date, end: e.date });
    });
    if (!periods.length) return null;
    const starts = periods.map((p) => p.start);
    const lens = [];
    for (let i = 1; i < starts.length; i++) {
      const L = dayDiff(starts[i - 1], starts[i]);
      if (L >= 18 && L <= 45) lens.push(L);
    }
    const avgLen = lens.length ? Math.round(mean(lens.slice(-6))) : null;
    const done = periods.filter((p) => dayDiff(p.end, today) > 2);
    const avgDur = done.length ? Math.max(1, Math.round(mean(done.slice(-6).map((p) => dayDiff(p.start, p.end) + 1)))) : 5;
    const lastStart = starts[starts.length - 1];
    const predStart = addDays(lastStart, avgLen || 28);
    const predEnd = addDays(predStart, avgDur - 1);
    const cycleDay = dayDiff(lastStart, today) + 1;
    const onPeriod = dayDiff(periods[periods.length - 1].end, today) <= 1;

    // water-weight effect: 5 days before a period vs a week earlier
    const pmsDiffs = [];
    starts.forEach((s) => {
      const pre = weightsBetween(addDays(s, -5), addDays(s, -1));
      const base = weightsBetween(addDays(s, -14), addDays(s, -8));
      if (pre.length >= 2 && base.length >= 2) pmsDiffs.push(mean(pre) - mean(base));
    });

    // past cycles' average weight
    const cycles = [];
    for (let i = 0; i < starts.length - 1; i++) {
      const w = weightsBetween(starts[i], addDays(starts[i + 1], -1));
      if (w.length >= 3) cycles.push({ start: starts[i], end: addDays(starts[i + 1], -1), avg: mean(w), n: w.length });
    }

    // same days of this cycle vs the previous one
    let cmp = null;
    if (starts.length >= 2) {
      const prevStart = starts[starts.length - 2];
      const k = Math.min(cycleDay, dayDiff(prevStart, lastStart));
      const cur = weightsBetween(lastStart, today);
      const prev = weightsBetween(prevStart, addDays(prevStart, k - 1));
      if (cur.length >= 2 && prev.length >= 2) cmp = { k, cur: mean(cur), prev: mean(prev) };
    }
    return { periods, starts, avgLen, avgDur, lastStart, predStart, predEnd, cycleDay, onPeriod,
      pms: pmsDiffs.length ? { diff: mean(pmsDiffs), n: pmsDiffs.length } : null, cycles, cmp };
  }

  // ---------- stats ----------
  function streak() {
    let n = 0, d = todayISO();
    if (!byDate(d)) d = addDays(d, -1); // today not logged yet doesn't break the streak
    while (byDate(d) && byDate(d).weight != null) { n++; d = addDays(d, -1); }
    return n;
  }
  const fmtD = (d) => (d === null || d === undefined ? '—' : (d > 0.04 ? '+' : d < -0.04 ? '-' : '±') + Math.abs(d).toFixed(1));
  function trendAt(iso) { // trend of the latest weigh-in on or before iso
    const w = entries.filter((e) => e.weight != null && e.date <= iso);
    return w.length ? trend.get(w[w.length - 1].date) : null;
  }
  function renderStats() {
    const w = entries.filter((e) => e.weight != null);
    const last = w[w.length - 1];
    const u = settings.units;
    if (!last) { $('stats').innerHTML = '<p class="empty">log a weigh-in to see stats ✧</p>'; return; }
    const tNow = trend.get(last.date);
    const tWeek = trendAt(addDays(last.date, -7));
    const dWeek = tWeek != null && dayDiff(w[0].date, last.date) >= 7 ? toDisp(tNow) - toDisp(tWeek) : null;
    const dAll = toDisp(tNow) - toDisp(w[0].weight);
    const arrow = dWeek === null ? '♡' : dWeek < -0.05 ? '▼' : dWeek > 0.05 ? '▲' : '▶';
    const cards = [
      ['total', w.length > 1 ? fmtD(dAll) : '—', dAll < 0 ? 'down' : ''],
      ['streak', `${streak()}🔥`, ''],
      settings.goal ? ['to goal', (toDisp(tNow) - toDisp(settings.goal)).toFixed(1), ''] : ['pics', String(entries.filter((e) => e.photo).length), '']
    ];
    $('stats').innerHTML = `
      <div class="stat hero ${dWeek !== null && dWeek < 0 ? 'down' : ''}">
        <span class="arrow">${arrow}</span>
        <div><span>trend · 7-day avg</span><b>${fmtW(tNow)}${u}</b>
        <small>latest ${fmtW(last.weight)}${u} · this week ${fmtD(dWeek)}</small></div>
      </div>` +
      cards.map(([k, v, c]) => `<div class="stat ${c}"><span>${k}</span><b>${v}</b></div>`).join('');
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
    const C = { ink: cssVar('--ink'), ink2: cssVar('--ink2'), grid: cssVar('--line'), line: cssVar('--chart'), red: '#ff3b5c', dot: cssVar('--pink') };

    const today = todayISO();
    let end = today;
    const all = entries.filter((e) => e.weight != null);
    let start = range ? addDays(end, -(range - 1)) : (all[0] ? all[0].date : end);
    if (!range && dayDiff(start, end) < 6) start = addDays(end, -6);
    // show an upcoming predicted period if it's within ~10 days
    const showPred = cyc && cyc.predStart > today && dayDiff(today, cyc.predStart) <= 10;
    if (showPred) end = cyc.predEnd;
    const data = all.filter((e) => e.date >= start && e.date <= end);
    const periods = entries.filter((e) => e.period && e.date >= start && e.date <= end);

    const L = 46, R = 12, T = 24, B = 30;
    const pw = W - L - R, ph = H - T - B;
    const span = Math.max(1, dayDiff(start, end));
    const xOf = (iso) => L + (dayDiff(start, iso) / span) * pw;

    ctx.font = '9px Px, monospace';
    ctx.textBaseline = 'middle';

    if (!data.length) {
      ctx.fillStyle = C.ink2; ctx.textAlign = 'center';
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

    // period columns (soft background) + ribbon under the axis
    const colW = Math.max(3, pw / (span + 1));
    ctx.fillStyle = 'rgba(255, 59, 92, 0.10)';
    periods.forEach((e) => ctx.fillRect(xOf(e.date) - colW / 2, T, colW, ph));
    ctx.fillStyle = C.red;
    periods.forEach((e) => ctx.fillRect(xOf(e.date) - colW / 2, T + ph + 3, colW, 4));

    // predicted period: dashed outline
    if (showPred) {
      const x0 = xOf(cyc.predStart) - colW / 2, x1 = xOf(cyc.predEnd) + colW / 2;
      ctx.strokeStyle = C.red; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
      ctx.strokeRect(x0, T + 1, x1 - x0, ph - 2);
      ctx.setLineDash([]);
      ctx.fillStyle = C.red; ctx.textAlign = 'center';
      ctx.fillText('🩸?', (x0 + x1) / 2, T - 10);
    }

    // grid
    const steps = 4;
    ctx.textAlign = 'right';
    for (let i = 0; i <= steps; i++) {
      const v = lo + ((hi - lo) * i) / steps;
      const y = Math.round(yOf(v));
      ctx.fillStyle = C.grid;
      for (let x = L; x < W - R; x += 6) ctx.fillRect(x, y, 2, 1);
      ctx.fillStyle = C.ink2;
      ctx.fillText(v.toFixed(1), L - 6, y);
    }
    // x labels
    ctx.fillStyle = C.ink2;
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

    const pts = data.map((e) => ({ x: xOf(e.date), y: yOf(toDisp(e.weight)), e }));
    chartPts = pts;
    ctx.lineCap = 'square'; ctx.lineJoin = 'miter';
    const seg = (a, b, col, w, alpha) => { ctx.globalAlpha = alpha; ctx.lineWidth = w; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.globalAlpha = 1; };

    // daily line — thin, turns red on period days
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const style = (p) => (p.e.period ? [C.red, 3, 1] : [C.line, 2, 0.45]);
      const sa = style(a), sb = style(b);
      if (sa[0] === sb[0]) seg(a, b, ...sa);
      else { const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; seg(a, m, ...sa); seg(m, b, ...sb); }
    }

    // trend line — thick and smooth-ish
    const tp = data.map((e) => ({ x: xOf(e.date), y: yOf(toDisp(trend.get(e.date))) }));
    if (tp.length > 1) {
      ctx.globalAlpha = 1; ctx.lineWidth = 4; ctx.strokeStyle = C.line; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(tp[0].x, tp[0].y);
      for (let i = 1; i < tp.length; i++) {
        const mx = (tp[i - 1].x + tp[i].x) / 2, my = (tp[i - 1].y + tp[i].y) / 2;
        ctx.quadraticCurveTo(tp[i - 1].x, tp[i - 1].y, mx, my);
      }
      ctx.lineTo(tp[tp.length - 1].x, tp[tp.length - 1].y);
      ctx.stroke();
    }

    // points + asterisks
    pts.forEach((p) => {
      ctx.fillStyle = C.ink;
      ctx.fillRect(Math.round(p.x) - 3, Math.round(p.y) - 3, 6, 6);
      ctx.fillStyle = p.e.period ? C.red : C.dot;
      ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
      if (p.e.pooped) {
        ctx.fillStyle = '#c58b00'; ctx.textAlign = 'center';
        ctx.font = '12px Px, monospace';
        ctx.fillText('*', p.x, p.y - 12);
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
    tip.textContent = `▸ ${niceDate(e.date)} · ${fmtW(e.weight)}${settings.units} (trend ${fmtW(trend.get(e.date))})${e.period ? ' · 🩸' : ''}${e.pooped ? ' · 💩' : ''}`;
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
    showBig(photoURL(e), e.date + '.jpg', `${niceDate(e.date)}${e.weight != null ? ' · ' + fmtW(e.weight) + settings.units : ''}`, true);
  }
  function showBig(src, title, info, nav) {
    $('viewerImg').src = src;
    $('viewerTitle').textContent = title;
    $('viewerInfo').textContent = info || '';
    $('viewerPrev').classList.toggle('hidden', !nav);
    $('viewerNext').classList.toggle('hidden', !nav);
    $('viewerPrev').disabled = viewIdx >= viewList.length - 1;
    $('viewerNext').disabled = viewIdx <= 0;
    resetZoom();
    $('viewer').classList.remove('hidden');
    viewerNav = nav;
  }
  let viewerNav = false;
  $('viewerClose').addEventListener('click', () => $('viewer').classList.add('hidden'));
  $('viewerPrev').addEventListener('click', () => openViewer(viewIdx + 1)); // older
  $('viewerNext').addEventListener('click', () => openViewer(viewIdx - 1)); // newer
  // tap today's preview to see it big
  el.thumb.addEventListener('click', () => {
    const img = el.thumb.querySelector('img');
    if (!img) return;
    const iso = el.date.value || todayISO();
    showBig(img.src, iso + '.jpg', niceDate(iso), false);
  });

  // pinch to zoom, drag to pan, double-tap to zoom in/out, swipe for next pic
  const stage = $('zoomStage'), zimg = $('viewerImg');
  const z = { s: 1, x: 0, y: 0 };
  const pts = new Map();
  let g = null, lastTap = 0;
  function applyZoom(anim) {
    zimg.style.transition = anim ? 'transform .2s ease-out' : 'none';
    zimg.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.s})`;
  }
  function resetZoom() { z.s = 1; z.x = 0; z.y = 0; applyZoom(false); }
  function clampPan() {
    const r = stage.getBoundingClientRect();
    const mx = (r.width * (z.s - 1)) / 2, my = (r.height * (z.s - 1)) / 2;
    z.x = Math.max(-mx, Math.min(mx, z.x)); z.y = Math.max(-my, Math.min(my, z.y));
  }
  function zoomAt(ns, cx, cy) {
    const r = stage.getBoundingClientRect();
    const ox = cx - (r.left + r.width / 2), oy = cy - (r.top + r.height / 2);
    z.x = ox - (ox - z.x) * (ns / z.s); z.y = oy - (oy - z.y) * (ns / z.s); z.s = ns;
    clampPan();
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  stage.addEventListener('pointerdown', (ev) => {
    stage.setPointerCapture(ev.pointerId);
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const p = [...pts.values()];
    if (p.length === 2) g = { type: 'pinch', d: dist(p[0], p[1]), s: z.s };
    else if (p.length === 1) g = { type: 'pan', x0: ev.clientX, y0: ev.clientY, x: z.x, y: z.y, t: Date.now() };
  });
  stage.addEventListener('pointermove', (ev) => {
    if (!pts.has(ev.pointerId) || !g) return;
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const p = [...pts.values()];
    if (g.type === 'pinch' && p.length >= 2) {
      const ns = Math.max(1, Math.min(5, g.s * dist(p[0], p[1]) / g.d));
      zoomAt(ns, (p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2);
      applyZoom(false);
    } else if (g.type === 'pan' && z.s > 1) {
      z.x = g.x + ev.clientX - g.x0; z.y = g.y + ev.clientY - g.y0; clampPan(); applyZoom(false);
    }
  });
  function endPointer(ev) {
    if (!pts.has(ev.pointerId)) return;
    pts.delete(ev.pointerId);
    if (g && g.type === 'pan' && pts.size === 0) {
      const dx = ev.clientX - g.x0, dy = ev.clientY - g.y0;
      const quick = Date.now() - g.t < 300 && Math.abs(dx) < 10 && Math.abs(dy) < 10;
      if (quick) {
        const now = Date.now();
        if (now - lastTap < 300) { // double tap
          if (z.s > 1) { z.s = 1; z.x = 0; z.y = 0; } else zoomAt(2.5, ev.clientX, ev.clientY);
          applyZoom(true); lastTap = 0;
        } else lastTap = now;
      } else if (z.s === 1 && viewerNav && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        openViewer(viewIdx + (dx > 0 ? 1 : -1));
      } else if (z.s === 1 && dy > 120 && Math.abs(dy) > Math.abs(dx)) {
        $('viewer').classList.add('hidden'); // swipe down to close
      }
    }
    if (pts.size === 1) { const p = [...pts.values()][0]; g = { type: 'pan', x0: p.x, y0: p.y, x: z.x, y: z.y, t: 0 }; }
    else if (pts.size === 0) { g = null; if (z.s < 1.05) { resetZoom(); applyZoom(true); } }
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  // stop iOS from zooming the whole page instead of the photo
  ['gesturestart', 'gesturechange'].forEach((t) => stage.addEventListener(t, (e) => e.preventDefault()));

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
    $('setPet').value = settings.pet;
    applyUnitsLabel();
    applyTheme();
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
    settings.pet = ($('setPet').value.trim() || 'mochi').slice(0, 12);
    store.set('pet', settings.pet);
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

  // ---------- cycle insights ----------
  function renderCycle() {
    const box = $('cycle');
    const u = settings.units;
    if (!cyc) { box.innerHTML = '<p class="muted">tick “on my period” on period days and i’ll learn your cycle ✧</p>'; return; }
    const today = todayISO();
    const L = [];
    const last = cyc.periods[cyc.periods.length - 1];
    if (cyc.onPeriod) L.push(`🩸 period day <b>${dayDiff(last.start, today) + 1}</b> — be gentle with yourself ♡`);
    else L.push(`🌙 cycle day <b>${cyc.cycleDay}</b>`);
    const until = dayDiff(today, cyc.predStart);
    const guess = cyc.avgLen ? '' : ' <span class="muted">(guessing 28 days until i’ve seen 2 periods)</span>';
    if (!cyc.onPeriod) {
      if (until > 0) L.push(`🔮 next period in <b>~${until} day${until === 1 ? '' : 's'}</b> · ${niceDate(cyc.predStart)}${guess}`);
      else if (until === 0) L.push(`🔮 period expected <b>around today</b>${guess}`);
      else L.push(`🔮 period expected ~${-until} day${until === -1 ? '' : 's'} ago <span class="muted">— cycles wobble, no stress (or did you forget to tick it?)</span>`);
    }
    if (cyc.avgLen) L.push(`📏 avg cycle <b>${cyc.avgLen} days</b> · period <b>~${cyc.avgDur} days</b>`);
    if (cyc.pms) {
      const d = toDisp(cyc.pms.diff);
      L.push(`💧 in the 5 days before your period you weigh <b>${fmtD(d)}${u}</b> vs the week before <span class="muted">(${cyc.pms.n} cycle${cyc.pms.n === 1 ? '' : 's'})</span>${d > 0.2 ? ' — that’s water, not fat ♡' : ''}`);
    } else {
      L.push('<span class="muted">💧 after a full cycle of weigh-ins i’ll show how much water weight your period brings</span>');
    }
    if (cyc.cmp) {
      const d = toDisp(cyc.cmp.cur) - toDisp(cyc.cmp.prev);
      L.push(`🔁 days 1–${cyc.cmp.k} of this cycle: avg <b>${fmtW(cyc.cmp.cur)}${u}</b> vs <b>${fmtW(cyc.cmp.prev)}${u}</b> last cycle (<b>${fmtD(d)}</b>)`);
    }
    if (cyc.cycles.length) {
      L.push('<span class="muted">📜 past cycles · avg weight</span><br>' +
        cyc.cycles.slice(-4).reverse().map((c) => `&nbsp;&nbsp;${shortDate(c.start)}–${shortDate(c.end)} · <b>${fmtW(c.avg)}${u}</b>`).join('<br>'));
    }
    box.innerHTML = L.map((l) => `<p>${l}</p>`).join('');
  }

  // ---------- before / after ----------
  let cmpMode = store.get('cmpMode', 'side');
  let cmpA = null, cmpB = null;
  function renderCompare() {
    const pics = entries.filter((e) => e.photo);
    const has = pics.length >= 2;
    $('cmpBody').classList.toggle('hidden', !has);
    $('cmpEmpty').classList.toggle('hidden', has);
    document.querySelectorAll('#cmpMode button').forEach((b) => b.classList.toggle('on', b.dataset.m === cmpMode));
    if (!has) return;
    if (!pics.some((e) => e.date === cmpA)) cmpA = pics[0].date;
    if (!pics.some((e) => e.date === cmpB)) cmpB = pics[pics.length - 1].date;
    const opts = pics.map((e) => `<option value="${e.date}">${shortDate(e.date)}${e.weight != null ? ' · ' + fmtW(e.weight) : ''}</option>`).join('');
    $('cmpA').innerHTML = opts; $('cmpB').innerHTML = opts;
    $('cmpA').value = cmpA; $('cmpB').value = cmpB;
    const A = byDate(cmpA), B = byDate(cmpB);
    const u = settings.units;
    const cap = (e) => `${shortDate(e.date)}${e.weight != null ? ` · <b>${fmtW(e.weight)}${u}</b>` : ''}`;
    const delta = A.weight != null && B.weight != null
      ? `<p class="note" style="grid-column:1/-1;text-align:center;margin:8px 0 0">${fmtD(toDisp(B.weight) - toDisp(A.weight))}${u} in ${Math.abs(dayDiff(A.date, B.date))} days ✧</p>` : '';
    const v = $('cmpView');
    if (cmpMode === 'side') {
      v.className = 'cmpview side';
      v.innerHTML = `<figure><img src="${photoURL(A)}" alt="before"><figcaption>${cap(A)}</figcaption></figure>
        <figure><img src="${photoURL(B)}" alt="after"><figcaption>${cap(B)}</figcaption></figure>${delta}`;
    } else {
      v.className = 'cmpview';
      v.innerHTML = `<div class="slider" id="sl"><img src="${photoURL(B)}" alt="after"><img src="${photoURL(A)}" alt="before" id="slA">
        <div class="handle" id="slH"></div><span class="tag a">${shortDate(A.date)}</span><span class="tag b">${shortDate(B.date)}</span></div>${delta}`;
      const sl = $('sl');
      const set = (p) => { p = Math.max(0, Math.min(100, p)); $('slA').style.clipPath = `inset(0 ${100 - p}% 0 0)`; $('slH').style.left = p + '%'; };
      const move = (ev) => { const r = sl.getBoundingClientRect(); set(((ev.clientX - r.left) / r.width) * 100); };
      sl.addEventListener('pointerdown', (ev) => { sl.setPointerCapture(ev.pointerId); move(ev); });
      sl.addEventListener('pointermove', (ev) => { if (ev.buttons || ev.pointerType === 'touch') move(ev); });
      set(50);
    }
  }
  $('cmpA').addEventListener('change', (e) => { cmpA = e.target.value; renderCompare(); });
  $('cmpB').addEventListener('change', (e) => { cmpB = e.target.value; renderCompare(); });
  document.querySelectorAll('#cmpMode button').forEach((b) => b.addEventListener('click', () => {
    cmpMode = b.dataset.m; store.set('cmpMode', cmpMode); renderCompare();
  }));

  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  function drawCover(ctx, img, x, y, w, h) {
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = w / s, sh = h / s;
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
  }
  async function shareBlob(blob, name, title) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  $('btnCmpExport').addEventListener('click', async () => {
    const A = byDate(cmpA), B = byDate(cmpB);
    if (!A || !B) return;
    const [ia, ib] = await Promise.all([loadImg(photoURL(A)), loadImg(photoURL(B))]);
    const PW = 540, PH = 720, P = 30, TOP = 110, BOT = 150;
    const W = PW * 2 + P * 3, H = TOP + PH + BOT;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const ink = cssVar('--ink'), hot = cssVar('--hot');
    ctx.fillStyle = cssVar('--bg'); ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    for (let x = 0; x < W; x += 24) for (let y = 0; y < H; y += 24) ctx.fillRect(x, y, 3, 3);
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '34px Px, monospace';
    ctx.fillText('✧ glow up ✧', W / 2, TOP / 2 + 4);
    const u = settings.units;
    [[ia, A, P], [ib, B, P * 2 + PW]].forEach(([img, e, x]) => {
      ctx.fillStyle = ink; ctx.fillRect(x - 8, TOP - 8, PW + 16, PH + 16);
      drawCover(ctx, img, x, TOP, PW, PH);
      ctx.fillStyle = ink; ctx.font = '44px Term, monospace';
      ctx.fillText(`${niceDate(e.date)}${e.weight != null ? ' · ' + fmtW(e.weight) + u : ''}`, x + PW / 2, TOP + PH + 46);
    });
    if (A.weight != null && B.weight != null) {
      ctx.fillStyle = hot; ctx.font = '26px Px, monospace';
      ctx.fillText(`${fmtD(toDisp(B.weight) - toDisp(A.weight))}${u} in ${Math.abs(dayDiff(A.date, B.date))} days ♡`, W / 2, H - 46);
    }
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    await shareBlob(blob, `glowup-${A.date}-to-${B.date}.png`, 'my progress ✧');
  });

  // ---------- weekly recap ----------
  function recapWeek() { // Sunday shows this week; other days show the last finished week
    const t = todayISO();
    const dow = fromISO(t).getDay();
    const sun = dow === 0 ? t : addDays(t, -dow);
    return { mon: addDays(sun, -6), sun };
  }
  function renderRecap() {
    const { mon, sun } = recapWeek();
    const days = [...Array(7)].map((_, i) => addDays(mon, i));
    const es = days.map(byDate);
    const logged = es.filter((e) => e && e.weight != null);
    const prev = weightsBetween(addDays(mon, -7), addDays(sun, -7));
    const avg = logged.length ? mean(logged.map((e) => e.weight)) : null;
    const pAvg = prev.length ? mean(prev) : null;
    const tEnd = trendAt(sun), tStart = trendAt(addDays(mon, -1));
    const n = logged.length;
    const [emoji, title] = n === 7 ? ['🏆', 'perfect week!!'] : n >= 5 ? ['⭐', 'superstar week'] : n >= 3 ? ['🌱', 'growing strong'] : n >= 1 ? ['🫧', 'every log counts'] : ['💤', 'rest week · fresh start ♡'];
    const u = settings.units;
    const per = es.filter((e) => e && e.period).length;
    const poo = es.filter((e) => e && e.pooped).length;
    const pics = es.filter((e) => e && e.photo).length;
    const rows = [
      ['days logged', `${n}/7`],
      ['avg weight', avg != null ? fmtW(avg) + u : '—'],
      ['vs last week', avg != null && pAvg != null ? fmtD(toDisp(avg) - toDisp(pAvg)) + u : '—'],
      ['trend change', tEnd != null && tStart != null ? fmtD(toDisp(tEnd) - toDisp(tStart)) + u : '—'],
      ['period days 🩸', String(per)],
      ['poop days 💩', `${poo}/7`],
      ['progress pics 📸', String(pics)]
    ];
    const note = per && avg != null && pAvg != null && avg > pAvg
      ? 'period week = water week. the scale is lying a little ♡'
      : n === 7 ? 'you showed up every single day. so proud ✧' : 'consistency > perfection. see you monday ♡';
    $('recapBody').innerHTML = `<div class="recap">
      <h3>week of ${shortDate(mon)} – ${shortDate(sun)}</h3>
      <div class="sticker"><span>${emoji}</span><b>${title}</b></div>
      <div class="days">${days.map((d, i) => { const e = es[i]; return `<i class="${e && e.weight != null ? 'on' : ''} ${e && e.period ? 'per' : ''}">${'mtwtfss'[i]}</i>`; }).join('')}</div>
      <table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      <p class="note" style="margin-top:12px">&gt; ${note}</p></div>`;
  }
  function openRecap() {
    renderRecap();
    $('recap').classList.remove('hidden');
    store.set('recapSeen', recapWeek().sun);
    $('recapBanner').classList.add('hidden');
  }
  function updateRecapBanner() {
    const isSunday = fromISO(todayISO()).getDay() === 0;
    $('recapBanner').classList.toggle('hidden', !(isSunday && entries.length && store.get('recapSeen', '') !== recapWeek().sun));
  }
  $('btnRecap').addEventListener('click', openRecap);
  $('recapBanner').addEventListener('click', openRecap);
  $('recapClose').addEventListener('click', () => $('recap').classList.add('hidden'));

  // ---------- pixel pet + stickers ----------
  const SPR = {
    egg: [
      '......oooo......', '....oowwwwoo....', '...owwwwwwwwo...', '..owwwpwwwwwwo..', '..owwwwwwwwpwo..',
      '.owwwwwwwwwwwwo.', '.owpwwwwwwwwwwo.', '.owwwwwwwwwpwwo.', '.owwwwwwwwwwwwo.', '.owwwwpwwwwwwwo.',
      '..owwwwwwwwwwo..', '..owwwwwwwpwwo..', '...owwwwwwwwo...', '....oowwwwoo....', '......oooo......'
    ],
    blob: [
      '....oooooooo....', '..oowwwwwwwwoo..', '.owwwwwwwwwwwwo.', '.owwwwwwwwwwwwo.', 'owwweewwwweewwwo',
      'owwweewwwweewwwo', 'owppwwwmmwwwppwo', 'owwwwwwwwwwwwwwo', '.owwwwwwwwwwwwo.', '.owwwwwwwwwwwwo.',
      '..oowwwwwwwwoo..', '....oooooooo....'
    ],
    ears: ['...oo......oo...', '..owpo....opwo..', '..owpo....opwo..', '..owpo....opwo..', '..owpo....opwo..', '..owpoooooopwo..']
  };
  const bunny = () => [...SPR.ears, ...SPR.blob.slice(1)];
  const STAGES = [
    { at: 0, key: 'egg', name: (n) => `${n}.egg`, k: 6 },
    { at: 3, key: 'baby', name: (n) => `baby ${n}`, k: 6 },
    { at: 7, key: 'bun', name: (n) => `${n} bun`, k: 7 },
    { at: 14, key: 'fancy', name: (n) => `fancy ${n}`, k: 7 },
    { at: 30, key: 'queen', name: (n) => `queen ${n}`, k: 7 },
    { at: 60, key: 'legend', name: (n) => `legendary ${n}`, k: 7 }
  ];
  const STICKERS = ['🍓', '🌸', '🎀', '🧁', '🦄', '🌈', '🍑', '💖', '⭐', '🐰', '🍒', '🌷', '🍰', '🦋', '🐱', '🍭', '🌙', '🫶', '🐣', '🍡', '💎', '🪩', '🌻', '👑'];

  function streakRuns() { // lengths of every run of consecutive weigh-in days
    const runs = [];
    let prev = null, len = 0;
    entries.filter((e) => e.weight != null).forEach((e) => {
      if (prev && dayDiff(prev, e.date) === 1) len++; else { if (len) runs.push(len); len = 1; }
      prev = e.date;
    });
    if (len) runs.push(len);
    return runs;
  }

  function drawPet(stage, happy) {
    const c = $('petCanvas');
    const ctx = c.getContext('2d');
    c.width = 160; c.height = 160;
    ctx.imageSmoothingEnabled = false;
    const pal = { o: cssVar('--ink') || '#4a2a40', w: cssVar('--pet') || '#fffaf2', p: '#ff9cc8', e: '#3a2030', m: '#3a2030', y: '#ffcc33', r: '#ff3b7f', R: '#c81e5c', s: '#ffe48a' };
    let spr = stage.key === 'egg' ? SPR.egg : stage.key === 'baby' ? SPR.blob : bunny();
    spr = spr.map((r) => r.split(''));
    const H = spr.length, k = stage.k;
    const ox = Math.round((160 - 16 * k) / 2), oy = 150 - H * k;
    const extra = [];
    if (!happy && stage.key !== 'egg') { // sleepy eyes: close them into a line
      spr.forEach((row) => row.forEach((ch, i) => { if (ch === 'e') row[i] = 'w'; }));
      const eyeRow = stage.key === 'baby' ? 5 : 10;
      [4, 5, 10, 11].forEach((i) => { spr[eyeRow][i] = 'e'; });
    }
    if (['fancy', 'queen', 'legend'].includes(stage.key)) extra.push([3, 11, 'r'], [3, 14, 'r'], [4, 11, 'r'], [4, 12, 'R'], [4, 13, 'R'], [4, 14, 'r'], [5, 11, 'r'], [5, 14, 'r']);
    if (['queen', 'legend'].includes(stage.key)) extra.push([2, 6, 'y'], [2, 9, 'y'], [3, 6, 'y'], [3, 7, 'y'], [3, 8, 'y'], [3, 9, 'y'], [4, 6, 'y'], [4, 7, 'r'], [4, 8, 'r'], [4, 9, 'y']);
    extra.forEach(([r, col, ch]) => { spr[r][col] = ch; });
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.12)';
    ctx.fillRect(ox + 3 * k, 151, 10 * k, 4);
    spr.forEach((row, y) => row.forEach((ch, x) => {
      if (ch === '.' || !pal[ch]) return;
      ctx.fillStyle = pal[ch];
      ctx.fillRect(ox + x * k, oy + y * k, k, k);
    }));
    if (stage.key === 'legend' || happy) { // sparkles
      ctx.fillStyle = stage.key === 'legend' ? '#ffcc33' : cssVar('--pink');
      [[14, 30], [138, 46], [24, 96], [140, 112]].slice(0, stage.key === 'legend' ? 4 : 2).forEach(([x, y]) => {
        ctx.fillRect(x, y - 4, 4, 12); ctx.fillRect(x - 4, y, 12, 4);
      });
    }
    c.classList.toggle('bounce', happy);
  }

  function renderPet() {
    const runs = streakRuns();
    const best = Math.max(0, ...runs);
    const cur = streak();
    const stIdx = STAGES.reduce((acc, s, i) => (best >= s.at ? i : acc), 0);
    const stage = STAGES[stIdx];
    const next = STAGES[stIdx + 1];
    const loggedToday = !!(byDate(todayISO()) && byDate(todayISO()).weight != null);
    const nm = settings.pet;
    $('petName').textContent = stage.name(nm);
    $('petMood').textContent = loggedToday
      ? (cur >= 7 ? `${nm} is so proud of you ✧` : `${nm} is happy you weighed in ♡`)
      : cur > 0 ? `${nm} is waiting for today’s weigh-in…` : entries.length ? `${nm} missed you! start a new streak ♡` : `log your first weigh-in to hatch ${nm} ✧`;
    if (next) {
      $('petXp').style.width = Math.min(100, (cur / next.at) * 100) + '%';
      $('petNext').textContent = `evolves at a ${next.at}-day streak · now ${cur}🔥`;
    } else {
      $('petXp').style.width = '100%';
      $('petNext').textContent = `max level!! streak ${cur}🔥`;
    }
    drawPet(stage, loggedToday);

    const earned = runs.reduce((s, L) => s + Math.floor(L / 7), 0);
    const freshToday = loggedToday && cur > 0 && cur % 7 === 0;
    const toNext = 7 - (cur % 7);
    const cells = [];
    for (let i = 0; i < earned; i++) cells.push(`<span class="${freshToday && i === earned - 1 ? 'new' : ''}" title="sticker ${i + 1}">${STICKERS[i % STICKERS.length]}</span>`);
    cells.push(`<span class="locked">${toNext}d</span>`);
    while (cells.length % 6) cells.push('<span class="locked">?</span>');
    $('stickers').innerHTML = cells.join('');
    $('stickerCount').textContent = `(${earned} · 1 per 7-day streak)`;
  }

  // ---------- themes ----------
  function applyTheme() {
    if (settings.theme && settings.theme !== 'pink') document.documentElement.dataset.theme = settings.theme;
    else delete document.documentElement.dataset.theme;
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = cssVar('--bg') || '#ffd6e8';
    document.querySelectorAll('#setTheme button').forEach((b) => b.classList.toggle('on', b.dataset.t === (settings.theme || 'pink')));
  }
  document.querySelectorAll('#setTheme button').forEach((b) => b.addEventListener('click', () => {
    settings.theme = b.dataset.t; store.set('theme', settings.theme);
    applyTheme(); renderAll();
  }));

  // ---------- render ----------
  function renderAll() {
    trend = computeTrend();
    cyc = computeCycle();
    renderStats(); drawChart(); renderCycle(); renderCompare(); renderPet(); renderGallery(); renderHistory();
    updateRecapBanner();
  }

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
    applyTheme();
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
