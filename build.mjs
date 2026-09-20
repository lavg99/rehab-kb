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
function layout({ title, desc, body, isHome = false, current = '/' }) {
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
</head>
<body>
<a class="skip" href="#main">ข้ามไปเนื้อหา</a>
${body}
${tabbar(current)}
<script src="${u('/assets/app.js')}"></script>
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
    steps,
    order: Number(meta.order ?? 999),
    html: md(body),
  };
}).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'th'));

// ---------- หน้าแรก ----------
const catCards = (SITE.categories || []).map(c => {
  const n = pages.filter(p => p.category === c.slug).length;
  const first = pages.find(p => p.category === c.slug);
  const href = n === 1 && first ? u(`/a/${first.slug}.html`) : u(`/c/${c.slug}.html`);
  return `    <li>
      <a class="cat" href="${esc(href)}">
        <img class="cat-img" src="${esc(u(c.image))}" alt="" loading="lazy" decoding="async" width="110" height="102">
        <span class="cat-body">
          <span class="cat-title">${esc(c.title)}</span>
          <span class="cat-desc">${esc(c.desc)}</span>
        </span>
        <span class="cat-chev" aria-hidden="true">›</span>
      </a>
    </li>`;
}).join('\n');

const homeBody = `<header class="topbar">
  <span class="back-btn" aria-hidden="true"></span>
  <div class="head-text">
    <h1 class="head-title">${esc(SITE.title)}</h1>
    <p class="head-sub">${esc(SITE.subtitle)}</p>
  </div>
  <button type="button" id="themeBtn" class="theme-btn" aria-label="สลับโหมดสว่าง/มืด" title="สลับโหมดสว่าง/มืด">${iconTheme}</button>
</header>

<main id="main" class="wrap">
  <section class="banner">
    <h2 class="banner-title">${esc(SITE.bannerTitle)}</h2>
    <p class="banner-sub">${esc(SITE.bannerSubtitle)}</p>
    ${SITE.bannerImage ? `<img class="banner-img" src="${esc(u(SITE.bannerImage))}" alt="" loading="lazy" decoding="async">` : ''}
  </section>

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

  <div class="btn-row">
    <a class="btn" href="${u('/c/article.html')}">บทความ</a>
    <a class="btn" href="${u('/c/video.html')}">วิดีโอท่าบริหาร</a>
  </div>

  <p class="foot">${esc(SITE.dept)} • ${esc(SITE.org)}</p>
</main>`;

writeFileSync(join(DIST, 'index.html'), layout({ isHome: true, body: homeBody, current: '/' }));

// ---------- หน้าบทเรียน ----------
mkdirSync(join(DIST, 'c'), { recursive: true });

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

  const body = `<div class="topbar-tint">
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

  ${p.videoUrl ? `<div class="btn-row"><a class="btn btn-primary btn-wide" href="${esc(p.videoUrl)}" target="_blank" rel="noopener">▶ เริ่มดูวิดีโอ</a></div>` : ''}

  ${tabsHtml}

  ${p.info.length ? `<div class="info">
${p.info.map(t => `    <p>${esc(t)}</p>`).join('\n')}
  </div>` : ''}

  <div class="btn-row">
    <button type="button" class="btn" data-save="${esc(p.slug)}">บันทึกไว้อ่าน</button>
    <a class="btn btn-primary" href="${u('/contact.html')}">สอบถามแผนก</a>
  </div>

  <p class="foot">${esc(SITE.dept)} • ${esc(SITE.org)}</p>
</main>`;

  writeFileSync(join(DIST, 'a', `${p.slug}.html`), layout({
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
  const items = g.list.map(p => `    <li>
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
  <ul class="cat-list" style="margin-top:20px">
${items || '    <li class="empty">ยังไม่มีเนื้อหาในหมวดนี้</li>'}
  </ul>
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

// ---------- ดัชนีค้นหา ----------
writeFileSync(join(DIST, 'search.json'), JSON.stringify(
  pages.map(p => ({ t: p.title, s: p.summary, u: u(`/a/${p.slug}.html`), i: p.cover ? u(p.cover) : '' })),
));

// ---------- assets + manifest ----------
cpSync(join(ROOT, 'assets'), join(DIST, 'assets'), { recursive: true });
writeFileSync(join(DIST, 'manifest.webmanifest'), JSON.stringify({
  name: `${SITE.title} · ${SITE.org}`, short_name: SITE.shortName,
  start_url: u('/') || '/', display: 'standalone',
  background_color: '#f0fafe', theme_color: SITE.themeColor,
  icons: [{ src: u('/assets/icon.svg'), sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
}, null, 2));
writeFileSync(join(DIST, '_headers'), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n`);

console.log(`สร้างเสร็จ: ${pages.length} บทเรียน + ${groups.length} หน้าหมวด + หน้าแรก/บันทึก/ติดต่อ`);
for (const p of pages) console.log(`  - ${p.title}  (/a/${p.slug}.html)${p.steps.length ? `  [${p.steps.length} ขั้นตอน]` : ''}`);
