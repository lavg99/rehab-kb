// สลับโหมดสว่าง/มืด — จำค่าไว้ในเครื่องผู้อ่าน
(() => {
  const KEY = 'rehab-kb-theme';
  const root = document.documentElement;

  const saved = localStorage.getItem(KEY);
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;

  const btn = document.getElementById('themeBtn');
  if (!btn) return;

  // ค่าตั้งต้น = สว่างเสมอ (ไม่ตามระบบ) ผู้อ่านกดเปลี่ยนเองได้
  const current = () => root.dataset.theme || 'light';

  const label = () => {
    btn.setAttribute('aria-label', current() === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด');
  };
  label();

  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    localStorage.setItem(KEY, next);
    label();
  });
})();
