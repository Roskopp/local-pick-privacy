// Builds local-pick.com's "What's in season" guide (/in-season) and sitemap.xml
// from the live Local Pick plant catalogue. Worldwide: no country or city pages.
//
// Run from anywhere (needs the Supabase CLI logged in and linked in fruit_map):
//   node tools/seo-pages/build.js
// Then deploy the site as usual. Re-run now and then to refresh the spot counts.
//
// Reads data with `supabase db query --read-only` only; it never writes to the database.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..');
const SITE = path.join(REPO, 'site');
const SUPABASE_WORKDIR = path.resolve(REPO, '..', 'fruit_map'); // holds supabase/ (linked project)
const ORIGIN = 'https://local-pick.com';
const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.localpick.app';
const APP_STORE_URL = 'https://apps.apple.com/app/id6831013392'; // iPhone app is live
const MIN_SPOTS = 25;       // plants with fewer spots on the map are left out of the guide

// ---------------------------------------------------------------- data

function query(sql) {
  const file = path.join(os.tmpdir(), `localpick-seo-${process.pid}.sql`);
  fs.writeFileSync(file, sql);
  const res = spawnSync('npx', ['supabase', 'db', 'query', '--remote', '--read-only',
    '--workdir', `"${SUPABASE_WORKDIR}"`, '--file', `"${file}"`, '-o', 'json'],
    { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  fs.unlinkSync(file);
  const out = res.stdout || '';
  const start = out.indexOf('{');
  if (res.status !== 0 || start < 0) throw new Error('Supabase query failed:\n' + (res.stderr || '') + out);
  return JSON.parse(out.slice(start)).rows;
}

// ---------------------------------------------------------------- text helpers

const num = (n) => Number(n).toLocaleString('en-NZ');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const listText = (items) => items.length <= 1 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_INFO = {
  spring: { title: 'Spring', months: 'March to May in the north, September to November in the south' },
  summer: { title: 'Summer', months: 'June to August in the north, December to February in the south' },
  autumn: { title: 'Autumn', months: 'September to November in the north, March to May in the south' },
  winter: { title: 'Winter', months: 'December to February in the north, June to August in the south' },
};

// Which seasons a catalogue season_guide covers, using the main season only: a
// "main crop/season" or "mostly" clause if there is one, otherwise the first
// sentence (later sentences cover exceptions and warm climates).
function seasonsOf(text) {
  const all = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!all) return [];
  const main = all.match(/(?:main (?:crop|season)|mostly|most (?:in|from))[^.;]*/);
  const t = main ? main[0] : (all.match(/^[^.]*/) || [all])[0];
  if (!main && /all year|year-round|year round|most of the year|any time of year/.test(t)) return [...SEASONS];
  const set = new Set();
  const range = /(spring|summer|autumn|winter)\b[^.;,]*?\b(?:to|into|through|until)\b[^.;,]*?\b(spring|summer|autumn|winter)/g;
  let m;
  while ((m = range.exec(t))) {
    let i = SEASONS.indexOf(m[1]);
    const end = SEASONS.indexOf(m[2]);
    for (let k = 0; k < 4; k++) { set.add(SEASONS[i]); if (i === end) break; i = (i + 1) % 4; }
  }
  for (const s of SEASONS) if (new RegExp(`\\b${s}\\b`).test(t)) set.add(s);
  return SEASONS.filter(s => set.has(s));
}

function firstSentence(text, max = 260) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = t.match(/^.*?[.!?](\s|$)/);
  let s = (m ? m[0] : t).trim();
  if (s.length > max) s = s.slice(0, s.lastIndexOf(' ', max)) + '…';
  return s;
}

// ---------------------------------------------------------------- page shell

const FONT_FACES = (() => {
  const L = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
  const X = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF';
  const f = (fam, w, file, r) => `@font-face{font-family:'${fam}';font-style:normal;font-weight:${w};font-display:swap;src:url(/fonts/${file}.woff2) format('woff2');unicode-range:${r};}`;
  return [f('Sora', '500 800', 'sora-latin-ext', X), f('Sora', '500 800', 'sora-latin', L),
          f('Work Sans', '400 600', 'worksans-latin-ext', X), f('Work Sans', '400 600', 'worksans-latin', L)].join('\n  ');
})();

const CSS = `
  ${FONT_FACES}
  :root{--cream:#EFF3E6;--cream-deep:#E5EAD6;--card:#fff;--green:#3F5D37;--green-dark:#20281C;--ink:#262B20;--muted:#6E7460;--border:#DCE2CC;--shadow:0 10px 30px rgba(32,40,28,0.10);--radius-md:18px;}
  *{box-sizing:border-box;}
  body{margin:0;background:var(--cream);color:var(--ink);font-family:'Work Sans',system-ui,sans-serif;line-height:1.6;}
  h1,h2,h3{font-family:'Sora',system-ui,sans-serif;color:var(--green-dark);line-height:1.2;margin:0 0 .5em;}
  h1{font-size:40px;font-weight:800;}
  h2{font-size:26px;margin-top:8px;}
  h3{font-size:17px;margin:0 0 4px;}
  p{margin:0 0 1em;}
  a{color:var(--green);}
  a:focus-visible,button:focus-visible{outline:3px solid var(--green-dark);outline-offset:3px;}
  img{max-width:100%;display:block;}
  .wrap{max-width:960px;margin:0 auto;padding:0 24px;}
  header.site-nav{position:sticky;top:0;z-index:20;background:rgba(239,243,230,0.94);backdrop-filter:blur(6px);border-bottom:1px solid var(--border);}
  .nav-inner{max-width:1080px;margin:0 auto;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;gap:12px;}
  .nav-brand{display:flex;align-items:center;gap:10px;font-family:'Sora',sans-serif;font-weight:700;font-size:18px;color:var(--green-dark);text-decoration:none;}
  .nav-brand img{width:34px;height:34px;border-radius:9px;}
  .nav-links{display:flex;align-items:center;gap:24px;}
  .nav-links a{color:var(--ink);text-decoration:none;font-size:15px;font-weight:500;}
  .btn{display:inline-flex;align-items:center;justify-content:center;padding:13px 26px;border-radius:999px;font-weight:600;font-size:15px;text-decoration:none;white-space:nowrap;}
  .btn-primary{background:var(--green);color:#fff !important;}
  .btn-primary:hover{background:var(--green-dark);}
  .btn-sm{padding:9px 18px;font-size:14px;}
  .crumbs{font-size:13.5px;color:var(--muted);margin:28px 0 10px;}
  .crumbs a{color:var(--muted);}
  .lede{font-size:18px;color:var(--muted);max-width:680px;}
  section{padding:36px 0;}
  .alt{background:var(--cream-deep);}
  .cards{display:grid;grid-template-columns:1fr;gap:14px;margin-top:18px;}
  .card{background:var(--card);border-radius:var(--radius-md);padding:18px 20px;box-shadow:var(--shadow);}
  .card .count{float:right;font-family:'Sora',sans-serif;font-weight:700;color:var(--green);font-size:15px;}
  .card p{color:var(--muted);font-size:14.5px;margin:0 0 6px;}
  .card p.when{color:var(--ink);}
  .card .sci{font-style:italic;color:var(--muted);font-size:13px;margin-bottom:6px;}
  .chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0;padding:0;list-style:none;}
  .chips li a{display:inline-block;background:var(--cream);border:1px solid var(--border);border-radius:999px;padding:6px 14px;font-size:14px;color:var(--green-dark);text-decoration:none;}
  .chips li a:hover{border-color:var(--green);}
  .season{background:var(--card);border-radius:var(--radius-md);box-shadow:var(--shadow);padding:20px 22px;margin-top:16px;}
  .season .months{color:var(--muted);font-size:14px;margin:-4px 0 6px;}
  .cta{background:var(--green-dark);color:#EFF3E6;border-radius:var(--radius-md);padding:28px;text-align:center;margin:8px 0;}
  .cta h2{color:#fff;}
  .cta p{color:#D8DFC8;}
  .cta .row{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;}
  .cta .btn-primary{background:#EFF3E6;color:var(--green-dark) !important;}
  .note{font-size:13px;color:var(--muted);}
  footer{padding:32px 0 28px;border-top:1px solid var(--border);text-align:center;}
  footer p{color:var(--muted);font-size:13px;margin:0 0 10px;}
  footer a{color:var(--green);text-decoration:none;font-weight:500;}
  @media(min-width:760px){.cards{grid-template-columns:repeat(2,1fr);}}
  @media(max-width:759px){h1{font-size:32px;}.nav-links a:not(.btn){display:none;}.lede{font-size:16.5px;}}
`;

function storeButtons() {
  const b = [`<a class="btn btn-primary" href="${PLAY_URL}" target="_blank" rel="noopener">Get it on Google Play</a>`];
  if (APP_STORE_URL) b.push(`<a class="btn btn-primary" href="${APP_STORE_URL}" target="_blank" rel="noopener">Download on the App Store</a>`);
  return b.join('\n        ');
}

function page({ title, description, urlPath, crumbs, body, ld = [] }) {
  const url = ORIGIN + urlPath;
  const breadcrumb = {
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Local Pick', path: '/' }, ...crumbs].map((c, i) => ({
      '@type': 'ListItem', position: i + 1, name: c.name, item: ORIGIN + c.path })),
  };
  const graph = { '@context': 'https://schema.org', '@graph': [breadcrumb, ...ld] };
  const crumbHtml = [{ name: 'Home', path: '/' }, ...crumbs].map((c, i, a) =>
    i === a.length - 1 ? esc(c.name) : `<a href="${c.path}">${esc(c.name)}</a>`).join(' › ');
  const iosNav = APP_STORE_URL ? `
<script>
  (function () {
    var ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios) document.getElementById('nav-get-app').href = '${APP_STORE_URL}';
  })();
</script>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<link rel="icon" type="image/png" href="/assets/favicon.png">
${APP_STORE_URL ? '<meta name="apple-itunes-app" content="app-id=6831013392">\n' : ''}<meta property="og:type" content="website">
<meta property="og:site_name" content="Local Pick">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${ORIGIN}/assets/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#3F5D37">
<link rel="preload" href="/fonts/sora-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/worksans-latin.woff2" as="font" type="font/woff2" crossorigin>
<style>${CSS}</style>
<script type="application/ld+json">
${JSON.stringify(graph)}
</script>
</head>
<body>
<!-- Generated by tools/seo-pages/build.js. Edit the generator, not this file. -->
<header class="site-nav">
  <div class="nav-inner">
    <a class="nav-brand" href="/"><img src="/assets/logo-160.webp" alt="" width="160" height="160">Local Pick</a>
    <nav class="nav-links">
      <a href="/#features">Features</a>
      <a href="/#faq">FAQ</a>
      <a class="btn btn-primary btn-sm" id="nav-get-app" href="${PLAY_URL}" target="_blank" rel="noopener">Get the app</a>
    </nav>
  </div>
</header>
<main>
  <div class="wrap"><p class="crumbs">${crumbHtml}</p></div>
${body}
</main>
<footer>
  <div class="wrap">
    <p><a href="/">Local Pick</a> &middot; <a href="/in-season">What’s in season</a> &middot; <a href="/#faq">FAQ</a></p>
    <p>Follow Local Pick: <a href="https://www.instagram.com/localpickapp/" target="_blank" rel="noopener">Instagram</a> &middot; <a href="https://www.facebook.com/yourlocalpickapp" target="_blank" rel="noopener">Facebook</a> &middot; <a href="mailto:hello@local-pick.com">hello@local-pick.com</a></p>
    <p>&copy; ${new Date().getFullYear()} Local Pick &middot; <a href="/privacy">Privacy Policy</a> &middot; <a href="/terms">Terms of Service</a></p>
  </div>
</footer>${iosNav}
</body>
</html>
`;
}

// ---------------------------------------------------------------- build

function build() {
  const catalog = query(`
select c.id, c.common_name, c.category, c.scientific_name, c.season_guide, c.ripeness_guide,
  (select count(*) from plant_locations l where l.plant_id = c.id and l.hidden_at is null) as n
from plant_catalog c;`);
  const today = new Date().toISOString().slice(0, 10);

  const guide = catalog
    .filter(c => c.category !== 'other' && Number(c.n) >= MIN_SPOTS && seasonsOf(c.season_guide).length)
    .sort((a, b) => a.common_name.localeCompare(b.common_name));
  const byCount = (a, b) => b.n - a.n;
  const chip = (c) => `<li><a href="#${c.id}">${esc(c.common_name)}</a></li>`;

  const seasonCards = SEASONS.map(s => {
    const list = guide.filter(c => { const ss = seasonsOf(c.season_guide); return ss.length < 4 && ss.includes(s); }).sort(byCount);
    return `        <div class="season" id="${s}">
          <h2>${SEASON_INFO[s].title}</h2>
          <p class="months">${SEASON_INFO[s].months}</p>
          <ul class="chips">${list.map(chip).join('')}</ul>
        </div>`;
  }).join('\n') + `
        <div class="season" id="all-year">
          <h2>All year</h2>
          <ul class="chips">${guide.filter(c => seasonsOf(c.season_guide).length === 4).sort(byCount).map(chip).join('')}</ul>
        </div>`;

  const speciesCards = guide.map(c => {
    const s = seasonsOf(c.season_guide).map(x => SEASON_INFO[x].title);
    return `        <div class="card" id="${c.id}">
          <span class="count">${num(c.n)} spots</span>
          <h3>${esc(c.common_name)}</h3>
          ${c.scientific_name ? `<div class="sci">${esc(c.scientific_name)}</div>` : ''}
          <p class="when"><strong>${esc(listText(s))}:</strong> ${esc(c.season_guide)}</p>
          ${c.ripeness_guide ? `<p><strong>Tip:</strong> ${esc(firstSentence(c.ripeness_guide))}</p>` : ''}
        </div>`;
  }).join('\n');

  const faq = [
    ['What fruit is in season right now?', 'It depends on your season, not the calendar month: the Northern and Southern Hemispheres have opposite seasons. In spring look for loquats, mulberries and the first berries; in summer, cherry plums, stone fruit, blackberries and passionfruit; in autumn, apples, pears, figs, feijoas, walnuts and chestnuts; and in winter, citrus such as lemons, mandarins and oranges.'],
    ['Why is the same fruit ripe at different times in different places?', 'Fruit ripens earlier in warm places and later in cool ones, and tropical regions follow wet and dry seasons instead of four seasons. Ripeness updates from foragers near you in the Local Pick app show what’s actually ready.'],
    ['How do I know if fruit is ripe enough to pick?', 'Most fruit is ready when it’s fully coloured, smells sweet, gives slightly when pressed and comes away from the branch easily. Each plant above has its own tip.'],
  ];

  fs.writeFileSync(path.join(SITE, 'in-season.html'), page({
    title: 'What’s in Season? Seasonal Foraging Calendar | Local Pick',
    description: 'A seasonal foraging calendar: which fruit, nuts and herbs are ripe in spring, summer, autumn and winter, and how to tell when they’re ready to pick.',
    urlPath: '/in-season', crumbs: [{ name: 'What’s in season', path: '/in-season' }],
    ld: [{ '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }],
    body: `  <section style="padding-top:0">
    <div class="wrap">
      <h1>What’s in season?</h1>
      <p class="lede">A foraging calendar for fruit, nuts and herbs. Find out what’s ready to pick each season, and how to tell when it’s ripe.</p>
${seasonCards}
      <p class="note" style="margin-top:16px">Seasons are for temperate climates. Fruit ripens earlier in warmer areas and later in cooler ones, and the tropics follow wet and dry seasons.</p>
    </div>
  </section>

  <section class="alt">
    <div class="wrap">
      <h2>Plants A to Z</h2>
      <p>The ${guide.length} most common edible plants on the Local Pick map, with how many spots have been mapped so far.</p>
      <div class="cards">
${speciesCards}
      </div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <h2>Questions</h2>
${faq.map(([q, a]) => `      <h3>${esc(q)}</h3>\n      <p>${esc(a)}</p>`).join('\n')}
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="cta">
        <h2>Find them on the map</h2>
        <p>Local Pick shows fruit trees, nut trees, herbs and drinking water near you, with ripeness updates from local foragers, photos and ratings. It’s free.</p>
        <div class="row">
        ${storeButtons()}
        </div>
      </div>
    </div>
  </section>`,
  }));

  const gitDate = (f) => {
    try { return execFileSync('git', ['log', '-1', '--format=%cs', '--', f], { cwd: SITE, encoding: 'utf8' }).trim() || today; }
    catch { return today; }
  };
  const urls = [['/', today], ['/in-season', today], ['/privacy', gitDate('privacy.html')], ['/terms', gitDate('terms.html')]];
  fs.writeFileSync(path.join(SITE, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, d]) => `  <url><loc>${ORIGIN}${u}</loc><lastmod>${d}</lastmod></url>`).join('\n')}
</urlset>
`);
  console.log(`Built the season guide (${guide.length} plants) and sitemap (${urls.length} URLs).`);
}

build();
