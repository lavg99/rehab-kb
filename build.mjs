// สร้างเว็บ static จากไฟล์ใน content/*.md — ใช้ node เปล่า ไม่มี dependency
// โครงหน้าทำตามดีไซน์ Figma (rehab-kb): หน้าแรก = แบนเนอร์ + ค้นหา + หมวด
//                                        หน้าบทเรียน = วิดีโอ + แท็บ + ขั้นตอน
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync, cpSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const CONTENT = join(ROOT, 'content');
const DIST = join(ROOT, 'dist');

const SITE = JSON.parse(readFileSync(join(ROOT, 'site.json'), 'utf8'));

// BASE = โฟลเดอร์ที่เว็บไปอยู่บนโฮสต์ เช่น GitHub Pages จะเป็น "/rehab-kb"
// ตั้งผ่าน env ตอน build:  BASE=/rehab-kb node build.mjs
// ถ้าเว็บอยู่ที่รากของโดเมน ไม่ต้องตั้ง
const BASE = (process.env.BASE || '').replace(/\/+$/, '');
const u = (path) => BASE + path;

// ---------- helper ----------
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** แยก frontmatter (--- ... ---) ออกจากเนื้อหา — รองรับ list แบบ "- ข้อความ" */
function splitFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  let curKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const li = line.match(/^\s*-\s+(.*)$/);
    if (li && curKey) { (meta[curKey] ||= []).push(unquote(li[1].trim())); continue; }
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (v === '') { curKey = k; meta[k] = []; continue; }
    curKey = null;
    meta[k] = unquote(v);
  }
  return { meta, body: m[2] };
}
function unquote(v) {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

/** markdown ย่อ: หัวข้อ, ย่อหน้า, รายการ, ตัวหนา, ลิงก์, รูป, เส้นคั่น, คำพูด */
function md(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let list = null;
  let para = [];

  const inline = (t) => esc(t)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, s) =>
      `<img src="${s}" alt="${alt}" loading="lazy" decoding="async">`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, href) => {
      const ext = /^https?:\/\//.test(href);
      return `<a href="${href}"${ext ? ' target="_blank" rel="noopener"' : ''}>${txt}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); closeList(); continue; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flushPara(); closeList(); const lv = Math.min(h[1].length + 1, 6); out.push(`<h${lv}>${inline(h[2])}</h${lv}>`); continue; }

    if (/^---+$/.test(line.trim())) { flushPara(); closeList(); out.push('<hr>'); continue; }

    const q = line.match(/^>\s?(.*)$/);
    if (q) { flushPara(); closeList(); out.push(`<blockquote><p>${inline(q[1])}</p></blockquote>`); continue; }

    const img = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (img) {
      flushPara(); closeList();
      out.push(`<figure><img src="${img[2]}" alt="${esc(img[1])}" loading="lazy" decoding="async">${img[1] ? `<figcaption>${esc(img[1])}</figcaption>` : ''}</figure>`);
      continue;
    }

    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const want = ul ? 'ul' : 'ol';
      if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }

    para.push(line.trim());
  }
  flushPara(); closeList();
  return out.join('\n');
}

// ---------- ชิ้นส่วนที่ใช้ซ้ำ ----------
const iconSearch = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
<path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

const iconTheme = `<svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
<path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor"/></svg>`;

function tabbar(current = '/') {
  const items = (SITE.nav || []).map(n => {
    // ปุ่มที่ active ต้องมีตัวเดียว — ใช้ href ตรงกับหน้าปัจจุบัน
    // หน้าแรก/บทเรียน/หมวด ให้ไฮไลต์ "คลังความรู้" (ตัวที่ตั้ง active ไว้ใน site.json)
    const on = current === '/' ? !!n.active : n.href === current;
    return `<a class="tab" href="${esc(u(n.href))}"${on ? ' aria-current="page"' : ''}>${esc(n.label)}</a>`;
  }).join('\n      ');
  return `<nav class="tabbar" aria-label="เมนูหลัก">
    <div class="tabbar-in">
      ${items}
    </div>
  </nav>`;
}

// ---------- โครงหน้า ----------
// มาตรวัดความเข้าใจท้ายบทความ (1-5) — ใช้คำนวณความพึงพอใจก่อน/หลังสำหรับ CQI
const FB_SCALE = [
  { v: 1, face: '😣', label: 'ไม่เข้าใจ' },
  { v: 2, face: '😕', label: 'เข้าใจน้อย' },
  { v: 3, face: '😐', label: 'พอเข้าใจ' },
  { v: 4, face: '🙂', label: 'เข้าใจ' },
  { v: 5, face: '😄', label: 'เข้าใจดีมาก' },
];

function layout({ title, desc, body, isHome = false, current = '/', track = '', noindex = false, extraJs = '' }) {
  const pageTitle = isHome ? `${SITE.title} · ${SITE.org}` : `${title} · ${SITE.title}`;
  return `<!doctype html>
<html lang="th" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${esc(pageTitle)}</title>
<script>
/* ตั้งธีมก่อนวาดหน้า กันภาพวาบ — ค่าตั้งต้นสว่าง */
window.__BASE__=${JSON.stringify(BASE)};
try{var t=localStorage.getItem('rehab-kb-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;}catch(e){}
</script>
<meta name="description" content="${esc(desc || SITE.description)}">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(desc || SITE.description)}">
<meta property="og:type" content="website">
${SITE.ogImage ? `<meta property="og:image" content="${esc(SITE.ogImage)}">` : ''}
<link rel="manifest" href="${u('/manifest.webmanifest')}">
<link rel="icon" href="${u('/assets/icon.svg')}" type="image/svg+xml">
<meta name="theme-color" content="${esc(SITE.themeColor)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;600;700&display=swap">
<link rel="stylesheet" href="${u('/assets/style.css')}">
${noindex ? '<meta name="robots" content="noindex">' : ''}
</head>
<body${track ? ` data-track="${esc(track)}"` : ''} data-fs="${esc(SITE.firestoreProject || '')}">
<a class="skip" href="#main">ข้ามไปเนื้อหา</a>
${body}
${tabbar(current)}
<script src="${u('/assets/app.js')}"></script>${extraJs ? `\n<script src="${u(extraJs)}"></script>` : ''}
</body>
</html>`;
}

// ---------- build ----------
if (existsSync(DIST)) rmSync(DIST, { recursive: true });
mkdirSync(join(DIST, 'a'), { recursive: true });

const files = existsSync(CONTENT) ? readdirSync(CONTENT).filter(f => f.endsWith('.md')) : [];
const pages = files.map(f => {
  const raw = readFileSync(join(CONTENT, f), 'utf8');
  const { meta, body } = splitFrontmatter(raw);
  const slug = meta.slug || basename(f, '.md');
  const steps = [];
  for (let i = 1; i <= 9; i++) {
    const t = meta[`step${i}`];
    if (!t) continue;
    steps.push({ no: i, title: t, desc: meta[`step${i}desc`] || '', img: meta[`step${i}img`] || '' });
  }
  return {
    slug,
    title: meta.title || slug,
    summary: meta.summary || '',
    category: meta.category || '',
    categoryTitle: meta.categoryTitle || '',
    cover: meta.cover || '',
    video: meta.video || '',
    videoUrl: meta.videoUrl || '',
    info: Array.isArray(meta.info) ? meta.info : (meta.info ? [meta.info] : []),
    // CQI: แหล่งอ้างอิง + ผู้ตรวจเนื้อหา (ค่าว่างใน frontmatter ถูกอ่านเป็น [] — แปลงเป็นข้อความว่าง)
    refs: Array.isArray(meta.refs) ? meta.refs.filter(Boolean) : (meta.refs ? [meta.refs] : []),
    reviewer: typeof meta.reviewer === 'string' ? meta.reviewer : '',
    reviewed: typeof meta.reviewed === 'string' ? meta.reviewed : '',
    // หน้าโรค: type: disease + ไอคอน + วิดีโอ YouTube + บทความที่เกี่ยวข้อง
    type: meta.type || 'article',
    icon: typeof meta.icon === 'string' ? meta.icon : '',
    youtube: typeof meta.youtube === 'string' ? meta.youtube : '',
    related: Array.isArray(meta.related) ? meta.related.filter(Boolean) : [],
    steps,
    order: Number(meta.order ?? 999),
    html: md(body),
  };
}).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'th'));

// ---------- หน้าแรก ----------
function iconSrc(name) { return u(`/assets/icons/${name}.svg`); }
const catCards = (SITE.categories || []).map(c => {
  const n = pages.filter(p => p.category === c.slug).length;
  const first = pages.find(p => p.category === c.slug);
  const href = n === 1 && first ? u(`/a/${first.slug}.html`) : u(`/c/${c.slug}.html`);
  return `    <li>
      <a class="cat" href="${esc(href)}">
        ${c.image ? `<img class="cat-img" src="${esc(u(c.image))}" alt="" loading="lazy" decoding="async" width="110" height="102">`
          : `<span class="cat-img cat-ic"><img src="${esc(iconSrc(c.icon))}" alt="" width="56" height="56"></span>`}
        <span class="cat-body">
          <span class="cat-title">${esc(c.title)}</span>
          <span class="cat-desc">${esc(c.desc)}</span>
        </span>
        <span class="cat-chev" aria-hidden="true">›</span>
      </a>
    </li>`;
}).join('\n');

const homeBody = `<header class="topbar">
  <span class="back-btn" aria-hidden="true">‹</span>
  <div class="head-text">
    <h1 class="head-title">${esc(SITE.title)}</h1>
    <p class="head-sub">${esc(SITE.subtitle)}</p>
  </div>
  <button type="button" id="themeBtn" class="theme-btn" aria-label="สลับโหมดสว่าง/มืด" title="สลับโหมดสว่าง/มืด">${iconTheme}</button>
</header>

<main id="main" class="wrap">
  <form class="search" role="search" onsubmit="return false">
    ${iconSearch}
    <label class="skip" for="q">ค้นหา</label>
    <input type="search" id="q" name="q" placeholder="${esc(SITE.searchPlaceholder)}" autocomplete="off">
  </form>

  <h2 class="section-h">${esc(SITE.sectionHeading)}</h2>
  <ul class="cat-list" id="catList">
${catCards || '    <li class="empty">ยังไม่มีหมวด</li>'}
  </ul>

  <ul class="cat-list" id="searchResults" hidden></ul>
  <p class="empty" id="searchEmpty" hidden>ไม่พบเนื้อหาที่ค้นหา</p>

  <p class="foot">${esc(SITE.dept)} • ${esc(SITE.org)}</p>
</main>`;

writeFileSync(join(DIST, 'index.html'), layout({ isHome: true, body: homeBody, current: '/' }));

// ---------- หน้าบทเรียน ----------
mkdirSync(join(DIST, 'c'), { recursive: true });

const ytId = (s = '') => (s.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/) || s.match(/^([\w-]{11})$/) || [])[1] || '';

const feedbackHtml = (p) => `<section class="feedback" data-fb="${esc(p.slug)}" aria-labelledby="fb-h-${esc(p.slug)}">
    <h3 class="fb-h" id="fb-h-${esc(p.slug)}">อ่านแล้วเข้าใจไหม</h3>
    <p class="fb-sub">แตะ 1 ครั้ง ช่วยให้แผนกปรับปรุงเนื้อหา</p>
    <div class="fb-row">
${FB_SCALE.map(f => `      <button type="button" class="fb-btn" data-score="${f.v}" aria-label="${esc(f.label)}"><span class="fb-face" aria-hidden="true">${f.face}</span><span class="fb-lbl">${esc(f.label)}</span></button>`).join('\n')}
    </div>
    <p class="fb-thanks" hidden>ขอบคุณสำหรับความเห็น</p>
  </section>`;

const refsHtml = (p) => `${p.refs.length ? `<section class="refs">
    <h3 class="refs-h">แหล่งอ้างอิง</h3>
    <ol>
${p.refs.map(x => `      <li>${esc(x)}</li>`).join('\n')}
    </ol>
  </section>` : ''}
  ${p.reviewer || p.reviewed ? `<p class="reviewed">${p.reviewer ? `ตรวจเนื้อหาโดย ${esc(p.reviewer)}` : ''}${p.reviewer && p.reviewed ? ' · ' : ''}${p.reviewed ? `ปรับปรุงล่าสุด ${esc(p.reviewed)}` : ''}</p>` : ''}`;

const listCard = (p) => `    <li>
      <a class="cat" href="${u(`/a/${esc(p.slug)}.html`)}">
        ${p.icon ? `<span class="cat-img cat-ic"><img src="${esc(iconSrc(p.icon))}" alt="" width="56" height="56"></span>`
          : p.cover ? `<img class="cat-img" src="${esc(u(p.cover))}" alt="" loading="lazy" decoding="async" width="110" height="102">` : ''}
        <span class="cat-body">
          <span class="cat-title">${esc(p.title)}</span>
          ${p.summary ? `<span class="cat-desc">${esc(p.summary)}</span>` : ''}
        </span>
        <span class="cat-chev" aria-hidden="true">›</span>
      </a>
    </li>`;

function diseaseBody(p, cat, crumb) {
  const id = ytId(p.youtube);
  const video = id
    ? `<div class="media video"><iframe src="https://www.youtube-nocookie.com/embed/${id}?rel=0" title="วิดีโอ ${esc(p.title)}" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
    : `<div class="media media-empty" role="img" aria-label="วิดีโอกำลังจัดทำ"><span class="me-play" aria-hidden="true">▶</span><span class="me-txt">วิดีโอสาธิตกำลังจัดทำ</span></div>`;
  const rel = p.related.map(s => pages.find(x => x.slug === s)).filter(Boolean);
  return `<div class="topbar-tint">
  <header class="topbar">
    <a class="back-btn" href="${u(cat ? `/c/${cat.slug}.html` : '/')}" aria-label="ย้อนกลับ">‹</a>
    <div class="head-text left">
      <h1 class="head-title sm">${esc(cat ? cat.title : 'โรคและอาการ')}</h1>
    </div>
  </header>
</div>

<main id="main" class="wrap">
  <p class="crumb">${crumb}</p>
  <div class="dz-hero">
    ${p.icon ? `<span class="dz-ic"><img src="${esc(iconSrc(p.icon))}" alt="" width="64" height="64"></span>` : ''}
    <div>
      <h2 class="lesson-title">${esc(p.title)}</h2>
      ${p.summary ? `<p class="lesson-sub">${esc(p.summary)}</p>` : ''}
    </div>
  </div>

  <h3 class="dz-h">วิดีโอแนะนำ</h3>
  ${video}

  <div class="prose dz-prose">${p.html}</div>

  ${rel.length ? `<h3 class="dz-h">ท่าบริหารที่เกี่ยวข้อง</h3>
  <ul class="cat-list">
${rel.map(listCard).join('\n')}
  </ul>` : ''}

  ${feedbackHtml(p)}

  <div class="btn-row">
    <button type="button" class="btn" data-save="${esc(p.slug)}">บันทึกไว้อ่าน</button>
    <a class="btn btn-primary" href="${u('/contact.html')}">สอบถามแผนก</a>
  </div>

  ${refsHtml(p)}

  <p class="foot">${esc(SITE.dept)} • ${esc(SITE.org)}</p>
</main>`;
}

for (const p of pages) {
  const cat = (SITE.categories || []).find(c => c.slug === p.category);
  const crumb = [`<a href="${u('/')}">หน้าหลัก</a>`, cat ? `<a href="${u(`/c/${cat.slug}.html`)}">${esc(cat.title)}</a>` : '', esc(p.categoryTitle || p.title)]
    .filter(Boolean).join(' › ');

  const stepsHtml = p.steps.length ? `<ul class="steps">
${p.steps.map(s => `    <li class="step">
      <span class="step-no">${s.no}</span>
      <span class="step-body">
        <span class="step-title">${esc(s.title)}</span>
        ${s.desc ? `<span class="step-desc">${esc(s.desc)}</span>` : ''}
      </span>
      ${s.img ? `<img class="step-img" src="${esc(u(s.img))}" alt="" loading="lazy" decoding="async" width="80" height="100">` : ''}
    </li>`).join('\n')}
  </ul>` : '';

  const hasTabs = stepsHtml && p.html;
  const tabsHtml = hasTabs ? `<div class="tabs" role="tablist">
    <button type="button" class="tab-btn" role="tab" id="tab-steps" aria-controls="panel-steps" aria-selected="true">ขั้นตอนการฝึก</button>
    <button type="button" class="tab-btn" role="tab" id="tab-note" aria-controls="panel-note" aria-selected="false">คำแนะนำ</button>
  </div>
  <div class="tab-panel" id="panel-steps" role="tabpanel" aria-labelledby="tab-steps">
    ${stepsHtml}
  </div>
  <div class="tab-panel" id="panel-note" role="tabpanel" aria-labelledby="tab-note" hidden>
    <div class="prose">${p.html}</div>
  </div>` : `${stepsHtml}${p.html ? `<div class="prose">${p.html}</div>` : ''}`;

  const body = p.type === 'disease' ? diseaseBody(p, cat, crumb) : `<div class="topbar-tint">
  <header class="topbar">
    <a class="back-btn" href="${u('/')}" aria-label="ย้อนกลับ">‹</a>
    <div class="head-text left">
      <h1 class="head-title sm">สื่อการสอน</h1>
    </div>
  </header>
</div>

<main id="main" class="wrap">
  <p class="crumb">${crumb}</p>
  <h2 class="lesson-title">${esc(p.title)}</h2>
  ${p.summary ? `<p class="lesson-sub">${esc(p.summary)}</p>` : ''}

  ${p.video ? `<div class="media">
    <img src="${esc(u(p.video))}" alt="" loading="lazy" decoding="async">
    ${p.videoUrl ? `<a class="media-play" href="${esc(p.videoUrl)}" target="_blank" rel="noopener" aria-label="เล่นวิดีโอ"><span aria-hidden="true">▶</span></a>` : ''}
  </div>` : ''}

  ${p.video ? `<div class="btn-row">${p.videoUrl
    ? `<a class="btn btn-primary btn-wide" href="${esc(p.videoUrl)}" target="_blank" rel="noopener">▶&nbsp; เริ่มดูวิดีโอ</a>`
    : `<button type="button" class="btn btn-primary btn-wide" disabled title="ยังไม่ได้ใส่ลิงก์วิดีโอ">▶&nbsp; เริ่มดูวิดีโอ</button>`}</div>` : ''}

  ${tabsHtml}

  ${p.info.length ? `<div class="info">
${p.info.map(t => `    <p>${esc(t)}</p>`).join('\n')}
  </div>` : ''}

  <section class="feedback" data-fb="${esc(p.slug)}" aria-labelledby="fb-h-${esc(p.slug)}">
    <h3 class="fb-h" id="fb-h-${esc(p.slug)}">อ่านแล้วเข้าใจไหม</h3>
    <p class="fb-sub">แตะ 1 ครั้ง ช่วยให้แผนกปรับปรุงเนื้อหา</p>
    <div class="fb-row">
${FB_SCALE.map(f => `      <button type="button" class="fb-btn" data-score="${f.v}" aria-label="${esc(f.label)}"><span class="fb-face" aria-hidden="true">${f.face}</span><span class="fb-lbl">${esc(f.label)}</span></button>`).join('\n')}
    </div>
    <p class="fb-thanks" hidden>ขอบคุณสำหรับความเห็น</p>
  </section>

  <div class="btn-row">
    <button type="button" class="btn" data-save="${esc(p.slug)}">บันทึกไว้อ่าน</button>
    <a class="btn btn-primary" href="${u('/contact.html')}">สอบถามแผนก</a>
  </div>

  ${p.refs.length ? `<section class="refs">
    <h3 class="refs-h">แหล่งอ้างอิง</h3>
    <ol>
${p.refs.map(x => `      <li>${esc(x)}</li>`).join('\n')}
    </ol>
  </section>` : ''}
  ${p.reviewer || p.reviewed ? `<p class="reviewed">${p.reviewer ? `ตรวจเนื้อหาโดย ${esc(p.reviewer)}` : ''}${p.reviewer && p.reviewed ? ' · ' : ''}${p.reviewed ? `ปรับปรุงล่าสุด ${esc(p.reviewed)}` : ''}</p>` : ''}

  <p class="foot">${esc(SITE.dept)} • ${esc(SITE.org)}</p>
</main>`;

  writeFileSync(join(DIST, 'a', `${p.slug}.html`), layout({
    track: p.slug,
    title: p.title, desc: p.summary, body, current: '/',
  }));
}

// ---------- หน้ารวมของแต่ละหมวด ----------
const groups = [
  ...(SITE.categories || []).map(c => ({ slug: c.slug, title: c.title, desc: c.desc, list: pages.filter(p => p.category === c.slug) })),
  { slug: 'article', title: 'บทความ', desc: 'บทความทั้งหมด', list: pages.filter(p => !p.video) },
  { slug: 'video', title: 'วิดีโอท่าบริหาร', desc: 'สื่อวิดีโอสาธิต', list: pages.filter(p => !!p.video) },
];

for (const g of groups) {
  const dz = g.list.filter(p => p.type === 'disease');
  const other = g.list.filter(p => p.type !== 'disease');
  const dzHtml = dz.length ? `<h3 class="dz-h">โรคและอาการ</h3>
  <ul class="dz-grid">
${dz.map(p => `    <li><a class="dz-card" href="${u(`/a/${esc(p.slug)}.html`)}">
      <span class="dz-ic">${p.icon ? `<img src="${esc(iconSrc(p.icon))}" alt="" width="52" height="52">` : ''}</span>
      <span class="dz-name">${esc(p.title)}</span>
      ${p.summary ? `<span class="dz-sum">${esc(p.summary)}</span>` : ''}
    </a></li>`).join('\n')}
  </ul>
  ${other.length ? '<h3 class="dz-h">ท่าบริหารและบทความ</h3>' : ''}` : '';
  const items = other.map(p => `    <li>
      <a class="cat" href="${u(`/a/${esc(p.slug)}.html`)}">
        ${p.cover ? `<img class="cat-img" src="${esc(u(p.cover))}" alt="" loading="lazy" decoding="async" width="110" height="102">` : ''}
        <span class="cat-body">
          <span class="cat-title">${esc(p.title)}</span>
          ${p.summary ? `<span class="cat-desc">${esc(p.summary)}</span>` : ''}
        </span>
        <span class="cat-chev" aria-hidden="true">›</span>
      </a>
    </li>`).join('\n');

  const body = `<div class="topbar-tint">
  <header class="topbar">
    <a class="back-btn" href="${u('/')}" aria-label="ย้อนกลับ">‹</a>
    <div class="head-text left"><h1 class="head-title sm">${esc(g.title)}</h1></div>
  </header>
</div>

<main id="main" class="wrap">
  <p class="crumb"><a href="${u('/')}">หน้าหลัก</a> › ${esc(g.title)}</p>
  <h2 class="lesson-title">${esc(g.title)}</h2>
  <p class="lesson-sub">${esc(g.desc)}</p>
  ${dzHtml}
  ${items ? `<ul class="cat-list" style="margin-top:${dz.length ? 12 : 20}px">
${items}
  </ul>` : (dz.length ? '' : '<ul class="cat-list" style="margin-top:20px"><li class="empty">ยังไม่มีเนื้อหาในหมวดนี้</li></ul>')}
  <p class="foot">${esc(SITE.dept)} • ${esc(SITE.org)}</p>
</main>`;

  writeFileSync(join(DIST, 'c', `${g.slug}.html`), layout({ title: g.title, desc: g.desc, body, current: '/' }));
}

// ---------- หน้าบันทึกไว้ / ติดต่อ ----------
writeFileSync(join(DIST, 'saved.html'), layout({
  title: 'บันทึกไว้', desc: 'เนื้อหาที่คุณบันทึกไว้อ่าน', current: '/saved.html',
  body: `<div class="topbar-tint">
  <header class="topbar">
    <a class="back-btn" href="${u('/')}" aria-label="ย้อนกลับ">‹</a>
    <div class="head-text left"><h1 class="head-title sm">บันทึกไว้</h1></div>
  </header>
</div>
<main id="main" class="wrap">
  <p class="crumb"><a href="${u('/')}">หน้าหลัก</a> › บันทึกไว้</p>
  <ul class="cat-list" id="savedList" style="margin-top:18px"></ul>
  <p class="empty" id="savedEmpty">ยังไม่มีเนื้อหาที่บันทึกไว้</p>
  <p class="foot">${esc(SITE.dept)} • ${esc(SITE.org)}</p>
</main>`,
}));

writeFileSync(join(DIST, 'contact.html'), layout({
  title: 'ติดต่อแผนก', desc: 'ติดต่อสอบถามแผนกฟื้นฟูสมรรถภาพ', current: '/contact.html',
  body: `<div class="topbar-tint">
  <header class="topbar">
    <a class="back-btn" href="${u('/')}" aria-label="ย้อนกลับ">‹</a>
    <div class="head-text left"><h1 class="head-title sm">ติดต่อแผนก</h1></div>
  </header>
</div>
<main id="main" class="wrap">
  <p class="crumb"><a href="${u('/')}">หน้าหลัก</a> › ติดต่อ</p>
  <h2 class="lesson-title">${esc(SITE.dept)}</h2>
  <p class="lesson-sub">${esc(SITE.org)}</p>
  <div class="info" style="margin-top:20px">
    <p>สอบถามเพิ่มเติมได้ที่แผนกฟื้นฟูสมรรถภาพ ในวันและเวลาราชการ</p>
    ${SITE.contact ? `<p>${esc(SITE.contact)}</p>` : ''}
  </div>
  <p class="foot">${esc(SITE.dept)} • ${esc(SITE.org)}</p>
</main>`,
}));

// ---------- หน้าสำหรับเจ้าหน้าที่: สถิติ (CQI) + QR ----------
// ไม่อยู่ในเมนูผู้ป่วย เปิดตรงจากลิงก์ /stats.html และ /qr.html
const staffTop = (title) => `<div class="topbar-tint">
  <header class="topbar">
    <a class="back-btn" href="${u('/')}" aria-label="ย้อนกลับ">‹</a>
    <div class="head-text left"><h1 class="head-title sm">${esc(title)}</h1></div>
  </header>
</div>`;

writeFileSync(join(DIST, 'stats.html'), layout({
  title: 'สถิติการใช้งาน', desc: 'ตัวชี้วัดสำหรับ CQI', current: '/stats.html', noindex: true, extraJs: '/assets/stats.js',
  body: `${staffTop('สถิติการใช้งาน')}
<main id="main" class="wrap wrap-wide">
  <p class="crumb"><a href="${u('/')}">หน้าหลัก</a> › สถิติ (สำหรับเจ้าหน้าที่)</p>

  <form class="st-range" id="stRange">
    <label>ตั้งแต่ <input type="date" id="stFrom" required></label>
    <label>ถึง <input type="date" id="stTo" required></label>
    <button type="submit" class="btn btn-primary">ดูข้อมูล</button>
  </form>

  <p class="st-status" id="stStatus">กำลังโหลด…</p>

  <section class="st-cards" id="stCards" hidden>
    <div class="st-card"><span class="st-num" id="kViews">0</span><span class="st-lbl">ครั้งที่เปิดอ่าน</span></div>
    <div class="st-card"><span class="st-num" id="kQr">0</span><span class="st-lbl">เปิดจาก QR</span></div>
    <div class="st-card"><span class="st-num" id="kFb">0</span><span class="st-lbl">คนตอบแบบประเมิน</span></div>
    <div class="st-card"><span class="st-num" id="kSat">–</span><span class="st-lbl">เข้าใจ/เข้าใจดีมาก</span></div>
  </section>

  <section class="st-block" id="stChartWrap" hidden>
    <h2 class="section-h">จำนวนการเปิดอ่านรายวัน</h2>
    <div class="st-chart" id="stChart"></div>
  </section>

  <section class="st-block" id="stTableWrap" hidden>
    <h2 class="section-h">แยกตามบทความ</h2>
    <div class="st-table-wrap">
      <table class="st-table">
        <thead><tr><th>บทความ</th><th>เปิดอ่าน</th><th>จาก QR</th><th>ตอบประเมิน</th><th>คะแนนเฉลี่ย (เต็ม 5)</th><th>เข้าใจขึ้นไป</th></tr></thead>
        <tbody id="stBody"></tbody>
      </table>
    </div>
  </section>

  <div class="btn-row">
    <button type="button" class="btn" id="stCsv" disabled>ดาวน์โหลดไฟล์ Excel (CSV)</button>
    <a class="btn btn-primary" href="${u('/qr.html')}">พิมพ์ QR บทความ</a>
  </div>
  <p class="st-note">นับทุกครั้งที่มีคนเปิดบทความ (คนเดิมเปิดซ้ำวันเดียวกันนับครั้งเดียว) · ไม่เก็บชื่อหรือข้อมูลส่วนตัวของผู้อ่าน</p>
  <p class="foot">${esc(SITE.dept)} • ${esc(SITE.org)}</p>
</main>`,
}));

const siteUrl = (SITE.siteUrl || '').replace(/\/+$/, '');
writeFileSync(join(DIST, 'qr.html'), layout({
  title: 'QR บทความ', desc: 'พิมพ์ QR ให้ผู้ป่วยสแกนอ่านที่บ้าน', current: '/qr.html', noindex: true,
  body: `${staffTop('QR บทความ')}
<main id="main" class="wrap wrap-wide">
  <p class="crumb no-print"><a href="${u('/')}">หน้าหลัก</a> › QR บทความ (สำหรับเจ้าหน้าที่)</p>
  <p class="lesson-sub no-print">พิมพ์แล้วแปะที่แผนก หรือให้ผู้ป่วยตอนกลับบ้าน สแกนแล้วเข้าบทความนั้นตรง ๆ และระบบนับแยกว่าเปิดจาก QR</p>
  <div class="btn-row no-print"><button type="button" class="btn btn-primary" id="qrPrint">พิมพ์หน้านี้</button></div>
  <ul class="qr-grid">
${pages.map(p => `    <li class="qr-card">
      <img src="${u(`/assets/qr/${esc(p.slug)}.svg`)}" alt="QR ${esc(p.title)}" width="180" height="180">
      <span class="qr-title">${esc(p.title)}</span>
      <span class="qr-org">${esc(SITE.dept)} ${esc(SITE.org)}</span>
      <span class="qr-url">${esc(siteUrl + `/a/${p.slug}.html`)}</span>
    </li>`).join('\n')}
  </ul>
</main>`,
}));

// ---------- ดัชนีค้นหา ----------
writeFileSync(join(DIST, 'search.json'), JSON.stringify(
  pages.map(p => ({ t: p.title, s: p.summary, u: u(`/a/${p.slug}.html`), i: p.icon ? iconSrc(p.icon) : (p.cover ? u(p.cover) : ''), ic: p.icon ? 1 : 0 })),
));

// ---------- assets + manifest ----------
cpSync(join(ROOT, 'assets'), join(DIST, 'assets'), { recursive: true });
// ไอคอนโรคใช้ผ่าน <img> — currentColor ไม่ทำงานใน <img> จึงใส่สีแบรนด์ลงไฟล์ตอน build
for (const f of readdirSync(join(DIST, 'assets', 'icons')).filter(f => f.endsWith('.svg'))) {
  const fp = join(DIST, 'assets', 'icons', f);
  writeFileSync(fp, readFileSync(fp, 'utf8').replaceAll('currentColor', SITE.themeColor || '#169fa5').replace('width="1em" height="1em" ', ''));
}
writeFileSync(join(DIST, 'manifest.webmanifest'), JSON.stringify({
  name: `${SITE.title} · ${SITE.org}`, short_name: SITE.shortName,
  start_url: u('/') || '/', display: 'standalone',
  background_color: '#f0fafe', theme_color: SITE.themeColor,
  icons: [{ src: u('/assets/icon.svg'), sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
}, null, 2));
writeFileSync(join(DIST, '_headers'), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n`);

console.log(`สร้างเสร็จ: ${pages.length} บทเรียน + ${groups.length} หน้าหมวด + หน้าแรก/บันทึก/ติดต่อ`);
for (const p of pages) console.log(`  - ${p.title}  (/a/${p.slug}.html)${p.steps.length ? `  [${p.steps.length} ขั้นตอน]` : ''}`);
