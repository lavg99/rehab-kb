// สร้างเว็บ static จากไฟล์ใน content/*.md  — ใช้ node เปล่า ไม่มี dependency
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync, cpSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const CONTENT = join(ROOT, 'content');
const DIST = join(ROOT, 'dist');

// ---------- ตั้งค่าเว็บ ----------
const SITE = JSON.parse(readFileSync(join(ROOT, 'site.json'), 'utf8'));

// ---------- helper ----------
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** แยก frontmatter (--- ... ---) ออกจากเนื้อหา */
function splitFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    meta[k] = v;
  }
  return { meta, body: m[2] };
}

/** markdown ย่อ: หัวข้อ, ย่อหน้า, รายการ, ตัวหนา, ลิงก์, รูป, เส้นคั่น, คำพูด */
function md(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let list = null;       // 'ul' | 'ol' | null
  let para = [];

  const inline = (t) => esc(t)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) =>
      `<img src="${src}" alt="${alt}" loading="lazy" decoding="async">`)
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
    if (h) { flushPara(); closeList(); const lv = h[1].length + 1; out.push(`<h${lv}>${inline(h[2])}</h${lv}>`); continue; }

    if (/^---+$/.test(line.trim())) { flushPara(); closeList(); out.push('<hr>'); continue; }

    const q = line.match(/^>\s?(.*)$/);
    if (q) { flushPara(); closeList(); out.push(`<blockquote><p>${inline(q[1])}</p></blockquote>`); continue; }

    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const want = ul ? 'ul' : 'ol';
      if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }

    // รูปเดี่ยวบรรทัดเดียว -> figure
    const img = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (img) {
      flushPara(); closeList();
      out.push(`<figure><img src="${img[2]}" alt="${esc(img[1])}" loading="lazy" decoding="async">${img[1] ? `<figcaption>${esc(img[1])}</figcaption>` : ''}</figure>`);
      continue;
    }

    para.push(line.trim());
  }
  flushPara(); closeList();
  return out.join('\n');
}

// ---------- โครงหน้า ----------
function layout({ title, desc, body, isHome, slug }) {
  const pageTitle = isHome ? SITE.title : `${title} · ${SITE.title}`;
  return `<!doctype html>
<html lang="th" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${esc(pageTitle)}</title>
<script>
/* ตั้งธีมก่อนวาดหน้า กันภาพวาบ — ค่าตั้งต้นสว่าง */
try{var t=localStorage.getItem('rehab-kb-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;}catch(e){}
</script>
<meta name="description" content="${esc(desc || SITE.description)}">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(desc || SITE.description)}">
<meta property="og:type" content="website">
${SITE.ogImage ? `<meta property="og:image" content="${esc(SITE.ogImage)}">` : ''}
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<meta name="theme-color" content="${SITE.themeColor}">
<link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<a class="skip" href="#main">ข้ามไปเนื้อหา</a>

<header class="banner">
  <div class="banner-in">
    ${SITE.logo ? `<img class="logo" src="${SITE.logo}" alt="">` : ''}
    <div class="banner-text">
      <p class="org">${esc(SITE.org)}</p>
      <p class="dept">${esc(SITE.dept)}</p>
    </div>
    <button type="button" id="themeBtn" class="theme-btn" aria-label="สลับโหมดสว่าง/มืด" title="สลับโหมดสว่าง/มืด">
      <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor"/>
      </svg>
    </button>
  </div>
</header>

<main id="main">
${body}
</main>

<footer>
  <p>${esc(SITE.org)} · ${esc(SITE.dept)}</p>
  ${SITE.contact ? `<p>${esc(SITE.contact)}</p>` : ''}
</footer>

<script src="/assets/app.js"></script>
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
  return {
    slug,
    title: meta.title || slug,
    summary: meta.summary || '',
    cover: meta.cover || '',
    order: Number(meta.order ?? 999),
    html: md(body),
  };
}).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'th'));

// หน้าแรก
const cards = pages.map(p => `
  <li class="card">
    <a href="/a/${p.slug}.html">
      ${p.cover ? `<img class="thumb" src="${p.cover}" alt="" loading="lazy" decoding="async">` : ''}
      <span class="card-body">
        <span class="card-title">${esc(p.title)}</span>
        ${p.summary ? `<span class="card-sum">${esc(p.summary)}</span>` : ''}
      </span>
    </a>
  </li>`).join('');

writeFileSync(join(DIST, 'index.html'), layout({
  isHome: true,
  desc: SITE.description,
  body: pages.length
    ? `<h1 class="page-h1">${esc(SITE.homeHeading)}</h1>\n<ul class="cards">${cards}</ul>`
    : `<h1 class="page-h1">${esc(SITE.homeHeading)}</h1>\n<p class="empty">ยังไม่มีเนื้อหา</p>`,
}));

// หน้าอ่าน
for (const p of pages) {
  writeFileSync(join(DIST, 'a', `${p.slug}.html`), layout({
    title: p.title, desc: p.summary, slug: p.slug,
    body: `<article class="article">
<h1>${esc(p.title)}</h1>
${p.html}
</article>
<p class="back"><a href="/">← กลับหน้าแรก</a></p>`,
  }));
}

// assets + manifest
cpSync(join(ROOT, 'assets'), join(DIST, 'assets'), { recursive: true });
writeFileSync(join(DIST, 'manifest.webmanifest'), JSON.stringify({
  name: SITE.title, short_name: SITE.shortName, start_url: '/', display: 'standalone',
  background_color: '#ffffff', theme_color: SITE.themeColor,
  icons: [{ src: '/assets/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
}, null, 2));
writeFileSync(join(DIST, '_headers'), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n`);

console.log(`สร้างเสร็จ: ${pages.length} หน้า + หน้าแรก`);
for (const p of pages) console.log(`  - ${p.title}  (/a/${p.slug}.html)`);
