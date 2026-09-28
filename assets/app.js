// คลังความรู้ แผนกฟื้นฟูฯ — สลับธีม / ค้นหา / แท็บ / บันทึกไว้อ่าน
(() => {
  'use strict';
  const root = document.documentElement;
  // โฟลเดอร์ที่เว็บอยู่บนโฮสต์ (ว่าง = อยู่ที่รากโดเมน)
  const BASE = window.__BASE__ || '';

  /* ---------- สลับโหมดสว่าง–มืด ---------- */
  const THEME_KEY = 'rehab-kb-theme';
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;

  const themeBtn = document.getElementById('themeBtn');
  if (themeBtn) {
    const current = () => root.dataset.theme || 'light';
    const label = () => themeBtn.setAttribute(
      'aria-label', current() === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด');
    label();
    themeBtn.addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      localStorage.setItem(THEME_KEY, next);
      label();
    });
  }

  /* ---------- แท็บในหน้าบทเรียน ---------- */
  const tabBtns = [...document.querySelectorAll('.tab-btn[role="tab"]')];
  if (tabBtns.length) {
    const show = (btn) => {
      tabBtns.forEach(b => {
        const on = b === btn;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        const panel = document.getElementById(b.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
    };
    tabBtns.forEach(b => b.addEventListener('click', () => show(b)));
    // ลูกศรซ้าย–ขวาเลื่อนแท็บ (ผู้ใช้คีย์บอร์ด)
    tabBtns.forEach((b, i) => b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = tabBtns[(i + (e.key === 'ArrowRight' ? 1 : tabBtns.length - 1)) % tabBtns.length];
      next.focus(); show(next);
    }));
  }

  /* ---------- บันทึกไว้อ่าน ---------- */
  const SAVE_KEY = 'rehab-kb-saved';
  const readSaved = () => {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY) || '[]'); } catch { return []; }
  };
  const writeSaved = (arr) => localStorage.setItem(SAVE_KEY, JSON.stringify(arr));

  document.querySelectorAll('[data-save]').forEach(btn => {
    const slug = btn.dataset.save;
    const sync = () => {
      const on = readSaved().some(x => x.u === `${BASE}/a/${slug}.html`);
      btn.textContent = on ? '✓ บันทึกแล้ว' : 'บันทึกไว้อ่าน';
      btn.classList.toggle('btn-primary', on);
    };
    sync();
    btn.addEventListener('click', () => {
      const url = `${BASE}/a/${slug}.html`;
      const list = readSaved();
      const i = list.findIndex(x => x.u === url);
      if (i >= 0) list.splice(i, 1);
      else {
        const t = document.querySelector('.lesson-title')?.textContent?.trim() || slug;
        const s = document.querySelector('.lesson-sub')?.textContent?.trim() || '';
        list.push({ t, s, u: url });
      }
      writeSaved(list);
      sync();
    });
  });

  /* ---------- หน้า "บันทึกไว้" ---------- */
  const savedList = document.getElementById('savedList');
  if (savedList) {
    const list = readSaved();
    const empty = document.getElementById('savedEmpty');
    if (list.length) {
      if (empty) empty.hidden = true;
      savedList.innerHTML = list.map(x => `<li>
        <a class="cat" href="${x.u}">
          <span class="cat-body">
            <span class="cat-title">${escapeHtml(x.t)}</span>
            ${x.s ? `<span class="cat-desc">${escapeHtml(x.s)}</span>` : ''}
          </span>
          <span class="cat-chev" aria-hidden="true">›</span>
        </a></li>`).join('');
    }
  }

  /* ---------- ค้นหาในหน้าแรก ---------- */
  const q = document.getElementById('q');
  const catList = document.getElementById('catList');
  const results = document.getElementById('searchResults');
  const searchEmpty = document.getElementById('searchEmpty');

  if (q && catList && results) {
    let index = null;
    const load = async () => {
      if (index) return index;
      try {
        const r = await fetch(`${BASE}/search.json`);
        index = await r.json();
      } catch { index = []; }
      return index;
    };

    let timer = null;
    q.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const term = q.value.trim().toLowerCase();
        if (!term) {
          catList.hidden = false;
          results.hidden = true;
          if (searchEmpty) searchEmpty.hidden = true;
          return;
        }
        const data = await load();
        const hit = data.filter(x =>
          (x.t || '').toLowerCase().includes(term) || (x.s || '').toLowerCase().includes(term));

        catList.hidden = true;
        results.hidden = hit.length === 0;
        if (searchEmpty) searchEmpty.hidden = hit.length > 0;

        results.innerHTML = hit.map(x => `<li>
          <a class="cat" href="${x.u}">
            ${x.i ? (x.ic ? `<span class="cat-img cat-ic"><img src="${x.i}" alt="" width="56" height="56"></span>` : `<img class="cat-img" src="${x.i}" alt="" loading="lazy">`) : ''}
            <span class="cat-body">
              <span class="cat-title">${escapeHtml(x.t)}</span>
              ${x.s ? `<span class="cat-desc">${escapeHtml(x.s)}</span>` : ''}
            </span>
            <span class="cat-chev" aria-hidden="true">›</span>
          </a></li>`).join('');
      }, 140);
    });
  }

  /* ---------- นับการเปิดอ่าน + แบบประเมินความเข้าใจ (ตัวชี้วัด CQI) ----------
     เก็บแค่: บทความไหน · วันที่ · มาจาก QR หรือไม่ · คะแนน 1-5 — ไม่มีชื่อหรือข้อมูลส่วนตัว */
  const FS = document.body.dataset.fs;
  const slug = document.body.dataset.track;
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const fsAdd = (col, fields) => {
    if (!FS) return Promise.resolve(false);
    const body = { fields: {} };
    for (const [k, v] of Object.entries(fields)) {
      body.fields[k] = typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) };
    }
    return fetch(`https://firestore.googleapis.com/v1/projects/${FS}/databases/(default)/documents/${col}`, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.ok).catch(() => false);
  };
  const isBot = /bot|crawl|spider|preview|facebookexternalhit|Line\/|HeadlessChrome/i.test(navigator.userAgent);

  if (slug && !isBot) {
    const params = new URLSearchParams(location.search);
    const src = params.get('src') === 'qr' ? 'qr' : 'web';
    // คนเดิมเปิดบทความเดิมวันเดียวกัน นับครั้งเดียว
    const seenKey = `rehab-kb-v:${slug}:${today()}`;
    let seen = false;
    try { seen = !!localStorage.getItem(seenKey); } catch {}
    if (!seen) {
      fsAdd('views', { a: slug, d: today(), src }).then(ok => {
        if (ok) try { localStorage.setItem(seenKey, '1'); } catch {}
      });
    }
    // เอา ?src=qr ออกจากแถบที่อยู่ ไม่ให้ติดไปตอนแชร์ต่อ
    if (params.has('src')) history.replaceState(null, '', location.pathname + location.hash);
  }

  document.querySelectorAll('[data-fb]').forEach(box => {
    const a = box.dataset.fb;
    const key = `rehab-kb-fb:${a}`;
    const btns = [...box.querySelectorAll('.fb-btn')];
    const thanks = box.querySelector('.fb-thanks');
    const mark = (v) => {
      btns.forEach(b => b.setAttribute('aria-pressed', b.dataset.score === String(v) ? 'true' : 'false'));
      if (thanks) thanks.hidden = false;
    };
    let prev = null;
    try { prev = localStorage.getItem(key); } catch {}
    if (prev) mark(prev);
    btns.forEach(b => b.addEventListener('click', () => {
      if (prev) { mark(prev); return; }          // ตอบได้ครั้งเดียวต่อเครื่อง
      const v = Number(b.dataset.score);
      prev = String(v);
      mark(v);
      try { localStorage.setItem(key, prev); } catch {}
      fsAdd('feedback', { a, s: v, d: today() });
    }));
  });

  const qrPrint = document.getElementById('qrPrint');
  if (qrPrint) qrPrint.addEventListener('click', () => window.print());

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
