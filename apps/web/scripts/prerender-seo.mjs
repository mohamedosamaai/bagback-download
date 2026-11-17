import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '..');
const distDir = path.join(webDir, 'dist');
const publicDir = path.join(webDir, 'public');
const BASE_URL = 'https://download.bagbacktech.com';

const SEO_PAGES = [
  {
    slug: 'youtube-downloader',
    priority: '0.95',
    changefreq: 'daily',
    title: 'تحميل فيديو من يوتيوب مجاناً — Bagback Download | دونلود يوتيوب HD MP4',
    description:
      'أسرع أداة تحميل ودونلود فيديو من يوتيوب مجاناً بجودة عالية 1080p و 720p MP4 أو صوت MP3 وحفظ مباشر على الهاتف والكمبيوتر بدون برامج إضافية.',
    keywords:
      'تحميل من يوتيوب, دونلود يوتيوب, تحميل فيديو يوتيوب, تنزيل فيديو يوتيوب MP4, youtube downloader hd, download youtube video free, Bagback Download',
    h1: 'تحميل فيديو من يوتيوب مجاناً بأعلى جودة MP4 & HD',
    introAr:
      'الصق رابط أي فيديو أو شورتس من يوتيوب في مدير التحميل السحابي Bagback Download لتحميله فوراً بجودة 1080p أو 720p أو استخراج الصوت النقي بضغطة واحدة.',
    h2: 'Free Fast YouTube HD Video Downloader Online & PWA',
    introEn:
      'Paste any YouTube watch or Shorts URL to download crisp HD MP4 video or high-bitrate MP3 audio directly to your phone or desktop with zero ads clutter.',
  },
  {
    slug: 'mp3-converter',
    priority: '0.90',
    changefreq: 'weekly',
    title: 'تحميل صوتيات وأغاني MP3 مجاناً — Bagback Download | دونلود MP3 سريع',
    description:
      'تحويل الفيديو إلى صوت MP3 عالي النقاء وتحميل المحاضرات والأغاني والبودكاست مباشرة على جهازك مجاناً بضغطة واحدة على أندرويد وآيفون والكمبيوتر.',
    keywords:
      'تحميل صوت mp3, تحويل يوتيوب الى mp3, دونلود mp3, تنزيل اغاني mp3 مجانا, youtube to mp3 converter, free mp3 downloader',
    h1: 'تحميل وتحويل الصوتيات إلى MP3 مجاناً بجودة نقية',
    introAr:
      'حوّل أي فيديو أو بودكاست أو قائمة صوتية إلى ملف MP3 أو Audio مباشر بدون فقدان الجودة مع دعم تسمية الملفات العربية والحفظ التلقائي في مجلدك.',
    h2: 'Extract High-Quality MP3 Audio from Any Video or Playlist',
    introEn:
      'Convert and download crisp MP3 audio tracks, lectures, and music playlists with one tap and automatic saving.',
  },
  {
    slug: 'playlist-downloader',
    priority: '0.90',
    changefreq: 'weekly',
    title: 'تحميل قائمة تشغيل كاملة بضغطة واحدة ZIP — Bagback Download | دونلود بلاي ليست',
    description:
      'تحميل ودونلود قوائم التشغيل الكاملة حتى 50 فيديو أو مقطع صوتي MP3 دفعة واحدة داخل ملف ZIP منظم أو مجلد مباشر مجاناً.',
    keywords:
      'تحميل قائمة تشغيل يوتيوب, تحميل بلاي ليست كاملة zip, دونلود قائمة تشغيل, playlist downloader zip, download full youtube playlist',
    h1: 'تحميل قوائم التشغيل الكاملة (Playlists) في ملف ZIP واحد',
    introAr:
      'بدلاً من حفظ عشرات المقاطع واحداً تلو الآخر، قم بتحليل رابط قائمة التشغيل بالكامل وحدد المقاطع المطلوبة لتحميلها كلها كحزمة ZIP منظمة بضغطة زر واحدة.',
    h2: 'One-Click Full Playlist ZIP Downloader (Up to 50 Tracks)',
    introEn:
      'Analyze any playlist, select up to 50 tracks as MP4 video or MP3 audio, and download the complete collection in a single UTF-8 ZIP bundle.',
  },
  {
    slug: 'download-video',
    priority: '0.90',
    changefreq: 'daily',
    title: 'تحميل ودونلود الفيديو مجاناً من جميع المواقع — Bagback Download',
    description:
      'موقع وتطبيق تحميل ودونلود الفيديوهات والملفات الصوتية مجاناً بسرعة صاروخية وأمان تام على الهاتف والكمبيوتر من أكثر من 1000 منصة.',
    keywords:
      'تحميل, دونلود, تحميل فيديو, موقع تحميل فيديوهات, برنامج دونلود مجاني, تنزيل فيديو للاندرويد والايفون, download video online, free video downloader',
    h1: 'تحميل ودونلود الفيديو مجاناً بأقصى سرعة من كل المنصات',
    introAr:
      'محرك تحميل ودونلود سحابي مفتوح المصدر يدعم الاستئناف وإيقاف التحميل مؤقتاً والأرشفة الذكية على جهازك بدون إعلانات مزعجة أو نوافذ منبثقة.',
    h2: 'Universal Free Online Video & Media Download Manager',
    introEn:
      'Fast, clean-room engineered cloud download manager with pause/resume, direct device save notifications, and PWA installation.',
  },
  {
    slug: 'tiktok-downloader',
    priority: '0.85',
    changefreq: 'weekly',
    title: 'تحميل فيديو تيك توك مجاناً MP4 — Bagback Download | دونلود تيك توك',
    description:
      'تنزيل وتحميل فيديوهات تيك توك عالية الدقة MP4 وحفظ الصوت MP3 على الموبايل والكمبيوتر مجاناً وبضغطة واحدة عبر Bagback Download.',
    keywords:
      'تحميل تيك توك, تنزيل فيديو تيك توك, دونلود تيك توك, tiktok video downloader, download tiktok mp4',
    h1: 'تحميل فيديوهات تيك توك (TikTok) بصيغة MP4 أو MP3 مجاناً',
    introAr:
      'انسخ رابط فيديو تيك توك والصقه لتحميله مباشرة بجودة عالية على جهازك أو استخراج الموسيقى الصوتية بضغطة واحدة.',
    h2: 'Fast TikTok MP4 Video & Sound Downloader',
    introEn:
      'Download TikTok clips in clean MP4 video or MP3 sound format right from your browser or installed PWA.',
  },
  {
    slug: 'instagram-downloader',
    priority: '0.85',
    changefreq: 'weekly',
    title: 'تنزيل ريلز وفيديو انستقرام مجاناً — Bagback Download | دونلود انستقرام',
    description:
      'تحميل ودونلود ريلز ومقاطع انستقرام بجودة أصلية عالية MP4 أو صوت MP3 مجاناً على الهاتف والكمبيوتر بأمان تام.',
    keywords:
      'تحميل ريلز انستقرام, تنزيل فيديو انستقرام, دونلود انستقرام, instagram reels downloader, download ig video',
    h1: 'تحميل ريلز وفيديوهات انستقرام (Instagram Reels) مجاناً',
    introAr:
      'احفظ مقاطع ريلز وفيديوهات انستقرام مباشرة على هاتفك أو حاسوبك بجودة عالية دون الحاجة لتثبيت تطبيقات خارجية مشبوهة.',
    h2: 'Download Instagram Reels & Video Clips in Full HD',
    introEn:
      'Save Instagram Reels and videos swiftly to your local storage with full privacy and zero sign-up.',
  },
  {
    slug: 'stats',
    priority: '0.65',
    changefreq: 'daily',
    title: 'لوحة إحصائيات الاستخدام والأداء المباشر — Bagback Download',
    description:
      'متابعة فورية لأداء منصة Bagback Download، حجم البيانات المعالجة، سرعة المعالجة، ونشاطك الشخصي المحفوظ على جهازك بدون تتبع أي روابط.',
    keywords:
      'احصائيات Bagback Download, لوحة الأداء, Live Usage Stats, Bagback Digital Solutions',
    h1: 'لوحة إحصائيات الاستخدام والأداء المباشر — Bagback Download',
    introAr:
      'استعرض أرقام الاستخدام الحية للمنصة العالمية جنباً إلى جنب مع ملخص تنزيلاتك الشخصية وحجم البيانات المحفوظ على جهازك.',
    h2: 'Real-Time Platform Telemetry & Personal Device Savings Showcase',
    introEn:
      'Explore live server download volume, success rate, processing speed, and your own personal saved media metrics.',
  },
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPageHtml(templateHtml, page) {
  const canonicalUrl = `${BASE_URL}/${page.slug}`;
  const siblingLinks = SEO_PAGES.filter((p) => p.slug !== 'stats')
    .map(
      (p) =>
        `<a href="/${p.slug}" style="display:inline-block;margin:4px 6px;color:#10b981;text-decoration:none;">${escapeHtml(
          p.title.split('—')[0].trim()
        )}</a>`
    )
    .join('\n          ');

  const mainContent = `<main style="max-width:740px;margin:0 auto;padding:32px 16px;color:#f9fafb;font-family:'Cairo','Inter',sans-serif;">
        <h1>${escapeHtml(page.h1)}</h1>
        <p>${escapeHtml(page.introAr)}</p>
        <h2>${escapeHtml(page.h2)}</h2>
        <p>${escapeHtml(page.introEn)}</p>
        <nav aria-label="Bagback Download Tools" style="margin-top:20px;">
          <a href="/" style="display:inline-block;margin:4px 6px;color:#10b981;font-weight:700;">Bagback Download الرئيسية</a>
          ${siblingLinks}
          <a href="/stats" style="display:inline-block;margin:4px 6px;color:#38bdf8;text-decoration:none;">لوحة الإحصائيات المباشرة</a>
        </nav>
      </main>`;

  let out = templateHtml;
  out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(page.title)}</title>`);
  out = out.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${escapeHtml(page.description)}" />`
  );
  out = out.replace(
    /<meta\s+name="keywords"\s+content="[^"]*"\s*\/?>/,
    `<meta name="keywords" content="${escapeHtml(page.keywords)}" />`
  );
  out = out.replace(
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/,
    `<link rel="canonical" href="${canonicalUrl}" />`
  );
  out = out.replace(
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:title" content="${escapeHtml(page.title)}" />`
  );
  out = out.replace(
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`
  );
  out = out.replace(
    /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:url" content="${canonicalUrl}" />`
  );
  out = out.replace(
    /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/,
    `<meta name="twitter:title" content="${escapeHtml(page.title)}" />`
  );
  out = out.replace(
    /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="twitter:description" content="${escapeHtml(page.description)}" />`
  );
  out = out.replace(/<main[\s\S]*?<\/main>/, mainContent);

  return out;
}

function buildSitemapXml(today) {
  const pageEntries = SEO_PAGES.map(
    (p) => `  <url>
    <loc>${BASE_URL}/${p.slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>${BASE_URL}/</loc>
    <xhtml:link rel="alternate" hreflang="ar" href="${BASE_URL}/" />
    <xhtml:link rel="alternate" hreflang="en" href="${BASE_URL}/?lang=en" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${BASE_URL}/" />
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${BASE_URL}/?lang=en</loc>
    <xhtml:link rel="alternate" hreflang="ar" href="${BASE_URL}/" />
    <xhtml:link rel="alternate" hreflang="en" href="${BASE_URL}/?lang=en" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${BASE_URL}/" />
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
${pageEntries}
</urlset>
`;
}

function readEnvOverrides() {
  const overrides = { ...process.env };
  for (const name of ['.env.local', '.env.production.local']) {
    const filePath = path.join(webDir, name);
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (/^[A-Z0-9_]+$/.test(key) && !(key in process.env)) {
        overrides[key] = val;
      }
    }
  }
  return overrides;
}

function injectOptionalMonetagSw(env) {
  const swPath = path.join(distDir, 'sw.js');
  if (!fs.existsSync(swPath)) return;
  const domain = (env.VITE_MONETAG_SW_DOMAIN || '').trim();
  const zoneId = (env.VITE_MONETAG_SW_ZONE || '').trim();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain) || !/^\d{4,16}$/.test(zoneId)) {
    return;
  }
  const existing = fs.readFileSync(swPath, 'utf8');
  if (existing.includes(domain) && existing.includes(zoneId)) return;
  const header = [
    `self.options = {"domain": "${domain}", "zoneId": ${zoneId}};`,
    `self.lary = "";`,
    `try { importScripts('https://${domain}/act/files/service-worker.min.js?r=sw'); } catch (e) {}`,
    '',
  ].join('\n');
  fs.writeFileSync(swPath, header + existing, 'utf8');
  console.log(`[Monetag] Attached verified Service Worker config for zone ${zoneId} inside dist/sw.js`);
}

function main() {
  const indexHtmlPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error(`Expected built HTML at ${indexHtmlPath}`);
  }

  const templateHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  for (const page of SEO_PAGES) {
    const html = buildPageHtml(templateHtml, page);
    const outPath = path.join(distDir, `${page.slug}.html`);
    fs.writeFileSync(outPath, html, 'utf8');
  }

  const env = readEnvOverrides();
  injectOptionalMonetagSw(env);

  const today = new Date().toISOString().slice(0, 10);
  const sitemapXml = buildSitemapXml(today);
  fs.writeFileSync(path.join(distDir, 'sitemap.xml'), sitemapXml, 'utf8');
  fs.writeFileSync(path.join(publicDir, 'sitemap.xml'), sitemapXml, 'utf8');

  console.log(`[SEO] Generated ${SEO_PAGES.length} pre-rendered static landing pages and updated sitemap.xml`);
}

main();
