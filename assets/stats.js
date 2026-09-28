// หน้าสถิติ (เจ้าหน้าที่) — ดึงข้อมูลจาก Firestore แล้วสรุปเป็นตัวชี้วัด CQI
(() => {
  'use strict';
  const FS = document.body.dataset.fs;
  const BASE = window.__BASE__ || '';
  const $ = (id) => document.getElementById(id);
  const statusEl = $('stStatus');
  const fmt = (n) => new Intl.NumberFormat('th-TH-u-nu-latn').format(n);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 29);
  $('stFrom').value = iso(from); $('stTo').value = iso(to);

  let titles = {};
  let lastRows = [];

  async function query(col, a, b) {
    const url = `https://firestore.googleapis.com/v1/projects/${FS}/databases/(default)/documents:runQuery`;
    const body = { structuredQuery: {
      from: [{ collectionId: col }],
      where: { compositeFilter: { op: 'AND', filters: [
        { fieldFilter: { field: { fieldPath: 'd' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: a } } },
        { fieldFilter: { field: { fieldPath: 'd' }, op: 'LESS_THAN_OR_EQUAL', value: { stringValue: b } } },
      ] } },
    } };
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const out = await r.json();
    return out.filter(x => x.document).map(x => {
      const f = x.document.fields || {};
      const o = {};
      for (const [k, v] of Object.entries(f)) o[k] = v.stringValue ?? Number(v.integerValue);
      return o;
    });
  }

  function chart(views, a, b) {
    const days = [];
    for (let d = new Date(a + 'T00:00'); iso(d) <= b; d.setDate(d.getDate() + 1)) days.push(iso(d));
    const per = Object.fromEntries(days.map(d => [d, 0]));
    views.forEach(v => { if (v.d in per) per[v.d]++; });
    const vals = days.map(d => per[d]);
    const max = Math.max(1, ...vals);
    const W = 640, H = 220, P = 32, bw = (W - P) / days.length;
    const bars = vals.map((v, i) => {
      const h = (v / max) * (H - 40);
      return `<rect x="${(P + i * bw + bw * 0.15).toFixed(1)}" y="${(H - 20 - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${days[i]}: ${v}</title></rect>`;
    }).join('');
    const step = Math.max(1, Math.ceil(days.length / 6));
    const labels = days.map((d, i) => i % step === 0 ? `<text x="${(P + i * bw + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${d.slice(8)}/${d.slice(5, 7)}</text>` : '').join('');
    $('stChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="จำนวนการเปิดอ่านรายวัน">
      <text x="2" y="14">${max}</text><text x="2" y="${H - 22}">0</text>
      <line x1="${P}" y1="${H - 20}" x2="${W}" y2="${H - 20}" class="axis"/>
      <g class="bars">${bars}</g><g class="lbl">${labels}</g></svg>`;
  }

  async function load() {
    const a = $('stFrom').value, b = $('stTo').value;
    if (!a || !b || a > b) { statusEl.textContent = 'ช่วงวันที่ไม่ถูกต้อง'; return; }
    statusEl.textContent = 'กำลังโหลด…'; statusEl.hidden = false;
    try {
      if (!Object.keys(titles).length) {
        const idx = await fetch(`${BASE}/search.json`).then(r => r.json());
        idx.forEach(x => { const m = x.u.match(/\/a\/([^/]+)\.html$/); if (m) titles[m[1]] = x.t; });
      }
      const [views, fb] = await Promise.all([query('views', a, b), query('feedback', a, b)]);
      const slugs = new Set([...Object.keys(titles), ...views.map(v => v.a), ...fb.map(f => f.a)]);
      const rows = [...slugs].map(s => {
        const v = views.filter(x => x.a === s), f = fb.filter(x => x.a === s);
        const sum = f.reduce((t, x) => t + (x.s || 0), 0);
        const good = f.filter(x => x.s >= 4).length;
        return { s, t: titles[s] || s, views: v.length, qr: v.filter(x => x.src === 'qr').length, n: f.length,
                 avg: f.length ? sum / f.length : null, good: f.length ? good / f.length : null };
      }).sort((x, y) => y.views - x.views);
      lastRows = rows;

      const allGood = fb.filter(x => x.s >= 4).length;
      $('kViews').textContent = fmt(views.length);
      $('kQr').textContent = fmt(views.filter(x => x.src === 'qr').length);
      $('kFb').textContent = fmt(fb.length);
      $('kSat').textContent = fb.length ? Math.round(allGood / fb.length * 100) + '%' : '–';
      $('stBody').innerHTML = rows.map(r => `<tr><td>${esc(r.t)}</td><td>${fmt(r.views)}</td><td>${fmt(r.qr)}</td><td>${fmt(r.n)}</td>
        <td>${r.avg == null ? '–' : r.avg.toFixed(2)}</td><td>${r.good == null ? '–' : Math.round(r.good * 100) + '%'}</td></tr>`).join('');
      chart(views, a, b);
      ['stCards', 'stChartWrap', 'stTableWrap'].forEach(id => $(id).hidden = false);
      $('stCsv').disabled = false;
      statusEl.hidden = !!views.length || !!fb.length;
      if (!views.length && !fb.length) statusEl.textContent = 'ยังไม่มีข้อมูลในช่วงนี้';
      window.__stViews = views;
    } catch (e) {
      statusEl.textContent = 'โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง'; statusEl.hidden = false;
    }
  }

  $('stRange').addEventListener('submit', (e) => { e.preventDefault(); load(); });

  // CSV สำหรับเปิดใน Excel ทำ run chart: สรุปรายบทความ + รายวัน
  $('stCsv').addEventListener('click', () => {
    const a = $('stFrom').value, b = $('stTo').value;
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = ['บทความ,เปิดอ่าน,จาก QR,ตอบประเมิน,คะแนนเฉลี่ย (เต็ม 5),ร้อยละเข้าใจขึ้นไป'];
    lastRows.forEach(r => lines.push([q(r.t), r.views, r.qr, r.n, r.avg == null ? '' : r.avg.toFixed(2), r.good == null ? '' : Math.round(r.good * 100)].join(',')));
    lines.push('', 'วันที่,เปิดอ่าน');
    const per = {};
    (window.__stViews || []).forEach(v => { per[v.d] = (per[v.d] || 0) + 1; });
    for (let d = new Date(a + 'T00:00'); iso(d) <= b; d.setDate(d.getDate() + 1)) lines.push(`${iso(d)},${per[iso(d)] || 0}`);
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `rehab-kb-stats-${a}-to-${b}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  });

  load();
})();
