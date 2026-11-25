// Builds local-pick.com's city foraging pages, the "in season" guide, the
// homepage city links and sitemap.xml from live Local Pick map data.
//
// Run from anywhere (needs the Supabase CLI logged in and linked in fruit_map):
//   node tools/seo-pages/build.js
// Then deploy the site as usual. Re-run every month or two to refresh the numbers.
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
const APP_STORE_URL = null; // set to 'https://apps.apple.com/app/id6831013392' once the iPhone app is live
const MIN_EDIBLE = 140;     // cities with fewer edible spots don't get a page (too thin to be useful)
const MIN_SEASON_GUIDE = 15; // species with fewer NZ+AU spots are left out of the season guide

// ---------------------------------------------------------------- data

function query(sql) {
  const file = path.join(os.tmpdir(), `localpick-seo-${process.pid}.sql`);
  fs.writeFileSync(file, sql);
  const res = spawnSync('npx', ['supabase', 'db', 'query', '--remote', '--read-only',
    '--workdir', SUPABASE_WORKDIR, '--file', file, '-o', 'json'],
    { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  fs.unlinkSync(file);
  const out = res.stdout || '';
  const start = out.indexOf('{');
  if (res.status !== 0 || start < 0) {
    throw new Error('Supabase query failed:\n' + (res.stderr || '') + out);
  }
  return JSON.parse(out.slice(start)).rows;
}

const cities = JSON.parse(fs.readFileSync(path.join(HERE, 'cities.json'), 'utf8'));
const num = (n) => Number(n).toLocaleString('en-NZ');
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

function loadData() {
  const values = cities.map(c => `(${sqlStr(c.slug)},${c.lat},${c.lon},${c.r})`).join(',\n');
  const cityRows = query(`
with cities(slug,lat,lon,r) as (values ${values}),
pts as (
  select c.slug, l.plant_id, l.category, l.suburb, l.land_type, l.plant_name
  from cities c join plant_locations l on l.hidden_at is null
   and l.latitude between c.lat - c.r/111.0 and c.lat + c.r/111.0
   and l.longitude between c.lon - c.r/(111.0*cos(radians(c.lat))) and c.lon + c.r/(111.0*cos(radians(c.lat)))
   and 111.32*sqrt(power(l.latitude-c.lat,2)+power((l.longitude-c.lon)*cos(radians(c.lat)),2)) <= c.r)
select c.slug,
 (select json_object_agg(category,n) from (select category,count(*) n from pts where pts.slug=c.slug group by 1) x) cats,
 (select count(distinct plant_id) from pts where pts.slug=c.slug and category<>'other') kinds,
 (select json_agg(json_build_array(plant_id,n) order by n desc) from (select plant_id,count(*) n from pts where pts.slug=c.slug and category<>'other' group by 1 order by 2 desc limit 30) x) top,
 (select json_agg(json_build_array(suburb,n) order by n desc) from (select suburb,count(*) n from pts where pts.slug=c.slug and category<>'other' and coalesce(suburb,'')<>'' group by 1 order by 2 desc limit 10) x) suburbs,
 (select count(*) from pts where pts.slug=c.slug and category<>'other' and lower(land_type)='public') public_land,
 (select json_object_agg(plant_name,n) from (select plant_name,count(*) n from pts where pts.slug=c.slug and category='other' group by 1) x) other
from cities c;`);
  const catalog = query(`
select c.id, c.common_name, c.category, c.scientific_name, c.season_guide, c.ripeness_guide,
  (select count(*) from plant_locations l where l.plant_id=c.id and l.hidden_at is null
     and l.country in ('New Zealand','Australia')) as n
from plant_catalog c;`);
  return { cityRows, catalog };
}

// ---------------------------------------------------------------- text helpers

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_INFO = {
  spring: { title: 'Spring', months: 'September to November' },
  summer: { title: 'Summer', months: 'December to February' },
  autumn: { title: 'Autumn', months: 'March to May' },
  winter: { title: 'Winter', months: 'June to August' },
};

// Which seasons a catalogue season_guide covers ("late winter to spring" -> winter, spring).
// Uses the main season only: a "main crop/season" or "mostly" clause if there is
// one, otherwise the first sentence (later sentences cover exceptions and warm climates).
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

function firstSentence(text, max = 220) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = t.match(/^.*?[.!?](\s|$)/);
  let s = (m ? m[0] : t).trim();
  if (s.length > max) s = s.slice(0, s.lastIndexOf(' ', max)) + '…';
  return s;
}

const listText = (items) => items.length <= 1 ? items.join('') :
  items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
const lc = (name) => name.toLowerCase();

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
  :root{--cream:#EFF3E6;--cream-deep:#E5EAD6;--card:#fff;--green:#3F5D37;--green-dark:#20281C;--gold:#CE8A15;--ink:#262B20;--muted:#6E7460;--border:#DCE2CC;--shadow:0 10px 30px rgba(32,40,28,0.10);--radius-md:18px;--radius-sm:12px;}
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
  .stats{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin:24px 0 8px;}
  .stat{background:var(--card);border-radius:var(--radius-md);padding:18px;box-shadow:var(--shadow);text-align:center;}
  .stat b{display:block;font-family:'Sora',sans-serif;font-weight:800;font-size:28px;color:var(--green);line-height:1.15;}
  .stat span{color:var(--muted);font-size:14px;}
  .cards{display:grid;grid-template-columns:1fr;gap:14px;margin-top:18px;}
  .card{background:var(--card);border-radius:var(--radius-md);padding:18px 20px;box-shadow:var(--shadow);}
  .card .count{float:right;font-family:'Sora',sans-serif;font-weight:700;color:var(--green);font-size:15px;}
  .card p{color:var(--muted);font-size:14.5px;margin:0 0 6px;}
  .card p.when{color:var(--ink);}
  .card .sci{font-style:italic;color:var(--muted);font-size:13px;margin-bottom:6px;}
  .chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0;padding:0;list-style:none;}
  .chips li a,.chips li span{display:inline-block;background:var(--card);border:1px solid var(--border);border-radius:999px;padding:6px 14px;font-size:14px;color:var(--green-dark);text-decoration:none;}
  .chips li a:hover{border-color:var(--green);}
  .season{background:var(--card);border-radius:var(--radius-md);box-shadow:var(--shadow);padding:20px 22px;margin-top:16px;}
  .season.now{outline:3px solid var(--gold);}
  .season .badge{display:none;margin-left:8px;background:var(--gold);color:#fff;border-radius:999px;padding:2px 10px;font-size:12px;font-family:'Work Sans',sans-serif;vertical-align:middle;}
  .season.now .badge{display:inline-block;}
  .season .months{color:var(--muted);font-size:14px;margin:-4px 0 6px;}
  .season .chips li a,.season .chips li span{background:var(--cream);}
  .cta{background:var(--green-dark);color:#EFF3E6;border-radius:var(--radius-md);padding:28px;text-align:center;margin:8px 0;}
  .cta h2{color:#fff;}
  .cta p{color:#D8DFC8;}
  .cta .row{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;}
  .cta .btn-primary{background:#EFF3E6;color:var(--green-dark) !important;}
  .tips li{margin-bottom:8px;}
  .note{font-size:13px;color:var(--muted);}
  footer{padding:32px 0 28px;border-top:1px solid var(--border);text-align:center;}
  footer p{color:var(--muted);font-size:13px;margin:0 0 10px;}
  footer a{color:var(--green);text-decoration:none;font-weight:500;}
  @media(min-width:760px){.stats{grid-template-columns:repeat(4,1fr);}.cards{grid-template-columns:repeat(2,1fr);}}
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
      <a href="/foraging/">Cities</a>
      <a href="/in-season">In season</a>
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
    <p><a href="/">Local Pick</a> &middot; <a href="/foraging/">Foraging by city</a> &middot; <a href="/in-season">What’s in season</a> &middot; <a href="/#faq">FAQ</a></p>
    <p>Follow Local Pick: <a href="https://www.instagram.com/localpickapp/" target="_blank" rel="noopener">Instagram</a> &middot; <a href="https://www.facebook.com/yourlocalpickapp" target="_blank" rel="noopener">Facebook</a> &middot; <a href="mailto:hello@local-pick.com">hello@local-pick.com</a></p>
    <p>&copy; ${new Date().getFullYear()} Local Pick &middot; <a href="/privacy">Privacy Policy</a> &middot; <a href="/terms">Terms of Service</a></p>
  </div>
</footer>${iosNav}
</body>
</html>
`;
}

function ctaBlock(where) {
  return `  <section>
    <div class="wrap">
      <div class="cta">
        <h2>Find them on the map</h2>
        <p>Local Pick shows every spot${where ? ' in ' + esc(where) : ''} on a live map, with ripeness updates from local foragers, photos and ratings. It’s free.</p>
        <div class="row">
        ${storeButtons()}
        </div>
      </div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------- builders

function build() {
  const { cityRows, catalog } = loadData();
  const cat = Object.fromEntries(catalog.map(c => [c.id, c]));
  const today = new Date();
  const monthYear = today.toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' });
  const isoDate = today.toISOString().slice(0, 10);

  // Species shown in the season guide (anchors that city pages can link to).
  const guideSpecies = catalog
    .filter(c => c.category !== 'other' && Number(c.n) >= MIN_SEASON_GUIDE && seasonsOf(c.season_guide).length)
    .sort((a, b) => a.common_name.localeCompare(b.common_name));
  const inGuide = new Set(guideSpecies.map(c => c.id));
  const speciesLink = (id) => inGuide.has(id)
    ? `<a href="/in-season#${id}">${esc(cat[id].common_name)}</a>` : `<span>${esc(cat[id].common_name)}</span>`;

  // ---- city pages
  const built = [];
  for (const c of cities) {
    const row = cityRows.find(r => r.slug === c.slug);
    if (!row) continue;
    const cats = row.cats || {};
    const edible = (cats.fruit || 0) + (cats.nut || 0) + (cats.herb || 0);
    if (edible < MIN_EDIBLE) continue;
    const other = row.other || {};
    const sumOther = (re) => Object.entries(other).filter(([k]) => re.test(k)).reduce((a, [, n]) => a + n, 0);
    const water = sumOther(/water/i);
    const gardens = sumOther(/garden/i);
    const food = sumOther(/food|meal/i);
    const top = (row.top || []).filter(([id]) => cat[id]);
    const top12 = top.slice(0, 12);
    const short = c.short || c.name;
    const names = top.slice(0, 4).map(([id]) => lc(cat[id].common_name));
    const country = c.country === 'NZ' ? 'New Zealand' : 'Australia';

    const cards = top12.map(([id, n]) => {
      const p = cat[id];
      const when = firstSentence(p.season_guide, 200);
      const tip = firstSentence(p.ripeness_guide, 200);
      return `        <div class="card">
          <span class="count">${num(n)}</span>
          <h3>${inGuide.has(id) ? `<a href="/in-season#${id}">${esc(p.common_name)}</a>` : esc(p.common_name)}</h3>
          ${p.scientific_name ? `<div class="sci">${esc(p.scientific_name)}</div>` : ''}
          ${when ? `<p class="when"><strong>When:</strong> ${esc(when)}</p>` : ''}
          ${tip ? `<p><strong>Tip:</strong> ${esc(tip)}</p>` : ''}
        </div>`;
    }).join('\n');

    const seasonal = top.filter(([id, n]) => n >= 3 && seasonsOf(cat[id].season_guide).length);
    const yearRound = seasonal.filter(([id]) => seasonsOf(cat[id].season_guide).length === 4).map(([id]) => id);
    const bySeason = SEASONS.map(s => ({ s, ids: seasonal.filter(([id]) => {
      const ss = seasonsOf(cat[id].season_guide);
      return ss.length < 4 && ss.includes(s);
    }).map(([id]) => id) })).filter(x => x.ids.length);
    const seasonHtml = bySeason.map(({ s, ids }) => `        <div class="season" data-season="${s}">
          <h3>${SEASON_INFO[s].title} <span class="badge">Now</span></h3>
          <p class="months">${SEASON_INFO[s].months}</p>
          <ul class="chips">${ids.map(id => `<li>${speciesLink(id)}</li>`).join('')}</ul>
        </div>`).join('\n') + (yearRound.length ? `
        <div class="season">
          <h3>All year</h3>
          <ul class="chips">${yearRound.map(id => `<li>${speciesLink(id)}</li>`).join('')}</ul>
        </div>` : '');

    const suburbs = (row.suburbs || []).filter(([, n]) => n >= 3);
    const suburbText = suburbs.length >= 3
      ? `<p>The most mapped suburbs right now are ${esc(listText(suburbs.slice(0, 8).map(([s, n]) => `${s} (${num(n)})`)))}. Many more spots are scattered across the rest of ${esc(c.name)}, so check the map for what’s near you.</p>`
      : '';
    const publicShare = edible ? Math.round(100 * row.public_land / edible) : 0;

    const stats = [
      [num(edible), 'fruit trees, nut trees and herbs'],
      [num(row.kinds), 'kinds of edible plants'],
      water ? [num(water), 'drinking water taps and fountains'] : null,
      publicShare >= 20 ? [`${publicShare}%`, 'on public land like streets and parks'] : (gardens + food ? [num(gardens + food), 'community gardens and free food spots'] : null),
    ].filter(Boolean).slice(0, 4);

    const body = `  <section style="padding-top:0">
    <div class="wrap">
      <h1>Foraging in ${esc(c.name)}</h1>
      <p class="lede">Free fruit trees, nut trees, herbs and drinking water around ${esc(c.name)}, mapped by local foragers and council open data. ${esc(short)}’s most common finds are ${esc(listText(names))}.</p>
      <div class="stats">
${stats.map(([b, s]) => `        <div class="stat"><b>${b}</b><span>${s}</span></div>`).join('\n')}
      </div>
      <p class="note">Figures from the Local Pick map within about ${c.r} km of central ${esc(short)}, ${monthYear}.</p>
    </div>
  </section>

  <section class="alt">
    <div class="wrap">
      <h2>What you can pick in ${esc(c.name)}</h2>
      <p>The most mapped plants around ${esc(short)}, with how many spots are on the map, when they’re usually ready and and how to tell they’re ready.</p>
      <div class="cards">
${cards}
      </div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <h2>When to go foraging in ${esc(c.name)}</h2>
      <p>What’s usually ripe in each season around ${esc(short)}. Exact timing changes from year to year and street to street, so check the ripeness updates in the app before you head out.</p>
${seasonHtml}
    </div>
  </section>

  <section class="alt">
    <div class="wrap">
      <h2>Where to look</h2>
      ${suburbText}
      <p>${row.public_land ? `${num(row.public_land)} of the edible spots around ${esc(short)} are on public land such as street berms, parks and reserves. ` : ''}${water ? `There are also ${num(water)} public drinking water taps and fountains on the map, handy for a long walk or ride. ` : ''}${gardens ? `And ${num(gardens)} community gardens, many of which welcome visitors and volunteers.` : ''}</p>
      <h3 style="margin-top:20px">Forage responsibly</h3>
      <ul class="tips">
        <li>Ask before picking from trees on private land, even if branches hang over the footpath.</li>
        <li>Check your local council’s rules for parks and reserves.</li>
        <li>Take only what you need and leave plenty for others and for wildlife.</li>
        <li>Only eat what you can identify with certainty, and wash what you pick, especially near busy roads.</li>
      </ul>
    </div>
  </section>

${ctaBlock(c.name)}

  <section>
    <div class="wrap">
      <h2>Foraging in other ${c.country === 'NZ' ? 'New Zealand' : 'Australian'} cities</h2>
      <ul class="chips">__OTHER_CITIES_${c.country}__</ul>
      <p style="margin-top:16px"><a href="/foraging/">All cities</a> &middot; <a href="/in-season">What’s in season in ${country}</a></p>
    </div>
  </section>`;
    built.push({ c, edible, water, body, names, title: `Foraging in ${short}: Free Fruit Trees & Edible Plants Map`,
      description: `Find free fruit trees in ${short}: ${num(edible)} foraging spots including ${listText(names.slice(0, 3))}, plus ${water ? num(water) + ' drinking water spots' : 'herbs and nuts'}. See what's ripe on the Local Pick map.` });
  }

  const chipFor = (b) => `<li><a href="/foraging/${b.c.slug}">${esc(b.c.short || b.c.name)}</a></li>`;
  fs.mkdirSync(path.join(SITE, 'foraging'), { recursive: true });
  for (const f of fs.readdirSync(path.join(SITE, 'foraging'))) fs.unlinkSync(path.join(SITE, 'foraging', f));
  for (const b of built) {
    const others = built.filter(o => o !== b && o.c.country === b.c.country).map(chipFor).join('');
    const body = b.body.replace(`__OTHER_CITIES_${b.c.country}__`, others);
    const html = page({
      title: b.title, description: b.description, urlPath: `/foraging/${b.c.slug}`,
      crumbs: [{ name: 'Foraging by city', path: '/foraging/' }, { name: b.c.short || b.c.name, path: `/foraging/${b.c.slug}` }],
      body: body + '\n' + seasonScript(),
    });
    fs.writeFileSync(path.join(SITE, 'foraging', `${b.c.slug}.html`), html);
  }

  // ---- hub page
  const group = (cc, label) => {
    const list = built.filter(b => b.c.country === cc).sort((a, b) => b.edible - a.edible);
    return `      <h2>${label}</h2>
      <div class="cards">
${list.map(b => `        <a class="card" href="/foraging/${b.c.slug}" style="text-decoration:none">
          <span class="count">${num(b.edible)}</span>
          <h3>${esc(b.c.short || b.c.name)}</h3>
          <p>${esc(listText(b.names.slice(0, 3)))}${b.water ? ` &middot; ${num(b.water)} water spots` : ''}</p>
        </a>`).join('\n')}
      </div>`;
  };
  const totalEdible = built.reduce((a, b) => a + b.edible, 0);
  fs.writeFileSync(path.join(SITE, 'foraging', 'index.html'), page({
    title: 'Foraging Maps for NZ & Australian Cities | Local Pick',
    description: `Free fruit trees, nut trees, herbs and drinking water in ${built.length} cities across New Zealand and Australia, from Auckland to Perth. Find foraging spots near you.`,
    urlPath: '/foraging/', crumbs: [{ name: 'Foraging by city', path: '/foraging/' }],
    body: `  <section style="padding-top:0">
    <div class="wrap">
      <h1>Foraging by city</h1>
      <p class="lede">Local Pick maps ${num(totalEdible)} free fruit trees, nut trees and herbs across these cities in New Zealand and Australia, plus public drinking water and community gardens. Pick your city to see what grows there and when it’s ripe.</p>
${group('NZ', 'New Zealand')}
      <div style="height:28px"></div>
${group('AU', 'Australia')}
      <p class="note" style="margin-top:20px">Numbers count spots within a short drive of each city centre, ${monthYear}. Smaller towns are on the map too.</p>
    </div>
  </section>
${ctaBlock('')}`,
  }));

  // ---- season guide
  const seasonCards = SEASONS.map(s => {
    const list = guideSpecies.filter(c => { const ss = seasonsOf(c.season_guide); return ss.length < 4 && ss.includes(s); })
      .sort((a, b) => b.n - a.n);
    return `        <div class="season" data-season="${s}" id="${s}">
          <h2>${SEASON_INFO[s].title} <span class="badge">Now</span></h2>
          <p class="months">${SEASON_INFO[s].months}</p>
          <ul class="chips">${list.map(c => `<li><a href="#${c.id}">${esc(c.common_name)}</a></li>`).join('')}</ul>
        </div>`;
  }).join('\n') + `
        <div class="season" id="all-year">
          <h2>All year</h2>
          <ul class="chips">${guideSpecies.filter(c => seasonsOf(c.season_guide).length === 4).sort((a, b) => b.n - a.n)
            .map(c => `<li><a href="#${c.id}">${esc(c.common_name)}</a></li>`).join('')}</ul>
        </div>`;
  const speciesCards = guideSpecies.map(c => {
    const s = seasonsOf(c.season_guide).map(x => SEASON_INFO[x].title);
    return `        <div class="card" id="${c.id}">
          <span class="count">${num(c.n)} spots</span>
          <h3>${esc(c.common_name)}</h3>
          ${c.scientific_name ? `<div class="sci">${esc(c.scientific_name)}</div>` : ''}
          <p class="when"><strong>${esc(listText(s))}:</strong> ${esc(c.season_guide)}</p>
          ${c.ripeness_guide ? `<p><strong>Tip:</strong> ${esc(firstSentence(c.ripeness_guide, 260))}</p>` : ''}
        </div>`;
  }).join('\n');
  const faq = [
    ['What fruit is in season in New Zealand and Australia right now?', 'Check the season highlighted at the top of this page. In spring look for loquats, mulberries and the first citrus; in summer, cherry plums, stone fruit, blackberries and passionfruit; in autumn, feijoas, apples, figs, walnuts and chestnuts; and in winter, citrus such as lemons, mandarins and oranges.'],
    ['When are feijoas in season?', 'Feijoas are an autumn fruit in most of New Zealand and southern Australia, roughly March to May. In warmer places the season can run from late summer into winter.'],
    ['Do seasons differ between cities?', 'Yes. Fruit ripens earlier in warmer places like Brisbane, Perth and Auckland than in Melbourne, Christchurch or Dunedin, and the tropical north follows wet and dry seasons instead. Ripeness updates from local foragers in the Local Pick app show what’s ready near you.'],
  ];
  fs.writeFileSync(path.join(SITE, 'in-season.html'), page({
    title: 'What’s in Season? Foraging Calendar for NZ & Australia | Local Pick',
    description: 'A seasonal foraging calendar for New Zealand and Australia: which fruit, nuts and herbs are ripe in spring, summer, autumn and winter, and how to tell when they’re ready to pick.',
    urlPath: '/in-season', crumbs: [{ name: 'What’s in season', path: '/in-season' }],
    ld: [{ '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }],
    body: `  <section style="padding-top:0">
    <div class="wrap">
      <h1>What’s in season?</h1>
      <p class="lede">A foraging calendar for New Zealand and Australia. Find out which fruit, nuts and herbs are ready to pick each season, and how to tell when they’re ripe.</p>
${seasonCards}
      <p class="note" style="margin-top:16px">Seasons are for the temperate south (most of New Zealand and southern Australia). Fruit ripens earlier in warmer areas and later in cooler ones, and the tropical north follows wet and dry seasons.</p>
    </div>
  </section>

  <section class="alt">
    <div class="wrap">
      <h2>Plants A to Z</h2>
      <p>The ${guideSpecies.length} most common edible plants on the Local Pick map, with the number of spots mapped in New Zealand and Australia.</p>
      <div class="cards">
${speciesCards}
      </div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <h2>Questions</h2>
${faq.map(([q, a]) => `      <h3>${esc(q)}</h3>\n      <p>${esc(a)}</p>`).join('\n')}
      <h3 style="margin-top:24px">Foraging by city</h3>
      <ul class="chips">${built.map(chipFor).join('')}</ul>
    </div>
  </section>

${ctaBlock('')}
${seasonScript()}`,
  }));

  // ---- homepage: city links block between markers
  const indexPath = path.join(SITE, 'index.html');
  let home = fs.readFileSync(indexPath, 'utf8');
  const block = `<!-- cities:start (generated by tools/seo-pages/build.js) -->
  <section id="cities">
    <div class="wrap">
      <h2 style="text-align:center; font-size:30px;">Foraging near you</h2>
      <p style="text-align:center; color:var(--muted); max-width:560px; margin:0 auto;">See what grows in your city and when it’s ripe, or browse the <a href="/in-season">seasonal foraging calendar</a>.</p>
      <div class="city-links">
        <div><h3>New Zealand</h3><ul>${built.filter(b => b.c.country === 'NZ').map(chipFor).join('')}</ul></div>
        <div><h3>Australia</h3><ul>${built.filter(b => b.c.country === 'AU').map(chipFor).join('')}</ul></div>
      </div>
    </div>
  </section>
  <!-- cities:end -->`;
  if (/<!-- cities:start[\s\S]*?<!-- cities:end -->/.test(home)) {
    home = home.replace(/<!-- cities:start[\s\S]*?<!-- cities:end -->/, block);
  } else {
    home = home.replace(/\r?\n  <section id="faq"/, '\n  ' + block + '\n\n  <section id="faq"');
  }
  if (!home.includes('<!-- cities:start')) throw new Error('could not place city links on the homepage');
  fs.writeFileSync(indexPath, home);

  // ---- sitemap
  const gitDate = (f) => {
    try { return execFileSync('git', ['log', '-1', '--format=%cs', '--', f], { cwd: SITE, encoding: 'utf8' }).trim() || isoDate; }
    catch { return isoDate; }
  };
  const urls = [
    ['/', isoDate], ['/foraging/', isoDate], ['/in-season', isoDate],
    ...built.map(b => [`/foraging/${b.c.slug}`, isoDate]),
    ['/privacy', gitDate('privacy.html')], ['/terms', gitDate('terms.html')],
  ];
  fs.writeFileSync(path.join(SITE, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, d]) => `  <url><loc>${ORIGIN}${u}</loc><lastmod>${d}</lastmod></url>`).join('\n')}
</urlset>
`);

  console.log(`Built ${built.length} city pages (${built.map(b => b.c.slug).join(', ')}),`);
  console.log(`the season guide (${guideSpecies.length} plants), the hub, homepage links and sitemap (${urls.length} URLs).`);
  const skipped = cities.filter(c => !built.find(b => b.c === c)).map(c => c.slug);
  if (skipped.length) console.log(`Skipped (fewer than ${MIN_EDIBLE} edible spots): ${skipped.join(', ')}`);
}

// Highlights the current southern-hemisphere season.
function seasonScript() {
  return `<script>
  (function () {
    var m = new Date().getMonth();
    var s = m >= 8 && m <= 10 ? 'spring' : (m === 11 || m <= 1) ? 'summer' : m <= 4 ? 'autumn' : 'winter';
    document.querySelectorAll('.season[data-season="' + s + '"]').forEach(function (el) { el.classList.add('now'); });
  })();
</script>`;
}

build();
