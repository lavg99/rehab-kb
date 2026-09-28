#!/usr/bin/env python3
# สร้าง QR (SVG) ของทุกบทความ -> assets/qr/<slug>.svg  (ลิงก์ติด ?src=qr เพื่อนับแยกว่ามาจาก QR)
import json, os, glob, qrcode, qrcode.image.svg
ROOT = os.path.dirname(os.path.abspath(__file__))
site = json.load(open(os.path.join(ROOT, 'site.json'), encoding='utf-8'))
base = site['siteUrl'].rstrip('/')
out = os.path.join(ROOT, 'assets', 'qr'); os.makedirs(out, exist_ok=True)
for f in sorted(glob.glob(os.path.join(ROOT, 'content', '*.md'))):
    slug = os.path.basename(f)[:-3]
    url = f'{base}/a/{slug}.html?src=qr'
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=2, box_size=10)
    q.add_data(url); q.make(fit=True)
    q.make_image(image_factory=qrcode.image.svg.SvgPathFillImage).save(os.path.join(out, slug + '.svg'))
    print(slug, url)
