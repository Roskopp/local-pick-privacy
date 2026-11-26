// One-off: design review changes to site/index.html (2026-11-27). Kept for reference.
// Usage: node tools/redesign-2026-11-27.js
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'site', 'index.html');
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const rep = (from, to) => {
  const ok = typeof from === 'string' ? s.includes(from) : from.test(s);
  if (!ok) throw new Error('not found: ' + String(from).slice(0, 90));
  s = s.replace(from, to);
};

// ---------- 1-3: defects
rep('    --muted:#6E7460;', '    --muted:#575D4A;');                       // text contrast >= 4.5:1
rep('  .nav-links a:hover{color:var(--green);}',
    '  .nav-links a:hover{color:var(--green);}\n  .nav-links a.btn-primary, .nav-links a.btn-primary:hover{color:#fff;}');
rep('  .section-alt{background:var(--cream-deep);}',
    '  .section-alt{background:var(--cream-deep);}\n  section[id], [id="notify"]{scroll-margin-top:84px;}');

// ---------- 7: a bit more contrast between sections
rep('    --cream-deep:#E5EAD6;', '    --cream-deep:#E1E8D0;');

// ---------- 4: hero with the app beside the headline
rep(/  \/\* ---- Hero ---- \*\/\n[\s\S]*?  \.hero \.region-note svg\{flex-shrink:0;\}\n/, `  /* ---- Hero ---- */
  .hero{padding:48px 0 56px; overflow:hidden;}
  .hero-grid{display:grid; grid-template-columns:1fr; gap:36px; align-items:center;}
  .hero-copy{display:flex; flex-direction:column; align-items:center; text-align:center; gap:16px;}
  .hero h1{font-size:46px; max-width:720px; margin:0;}
  .hero .tagline{font-size:18px; color:var(--muted); max-width:560px; margin:0;}
  .hero .region-note{
    display:inline-flex; align-items:center; gap:8px;
    background:var(--card); border:1px solid var(--border);
    padding:7px 16px; border-radius:999px; font-size:13.5px; color:var(--muted);
  }
  .hero .region-note svg{flex-shrink:0;}
  .hero-shot{position:relative; justify-self:center; width:100%; max-width:270px;}
  .hero-shot::before{content:''; position:absolute; inset:8% -18% -6% -18%; background:radial-gradient(closest-side, rgba(206,138,21,0.22), rgba(206,138,21,0)); z-index:0;}
  .hero-shot .shot-frame{position:relative; z-index:1; max-width:none; margin:0; transform:rotate(3deg); box-shadow:0 24px 50px rgba(32,40,28,0.25);}
  .ripe-chips{position:absolute; z-index:2; left:-34px; bottom:56px; display:flex; flex-direction:column; gap:8px;}
  .ripe-chips span{display:inline-flex; align-items:center; gap:7px; background:#fff; border-radius:999px; padding:6px 12px 6px 9px; font-size:12.5px; font-weight:600; color:var(--ink); box-shadow:var(--shadow); white-space:nowrap;}
  .ripe-chips i{width:10px; height:10px; border-radius:50%; display:inline-block;}
`);
rep('  .signup{\n    width:100%; max-width:440px; margin-top:8px;\n    display:flex; flex-direction:column; align-items:stretch; gap:12px;\n  }',
    '  .signup{\n    width:100%; max-width:440px; margin-top:2px;\n    display:flex; flex-direction:column; align-items:center; gap:12px;\n  }\n  .signup form{width:100%;}\n  .notify-toggle{background:none; border:none; padding:4px 2px; font:inherit; font-size:14px; color:var(--green); font-weight:600; text-decoration:underline; text-underline-offset:3px; cursor:pointer;}\n  .notify-toggle:hover{color:var(--green-dark);}');

const heroOld = s.match(/  <section class="hero">\n[\s\S]*?\n  <\/section>\n/)[0];
const playBtn = heroOld.match(/        <a class="play-btn"[\s\S]*?<\/a>\n/)[0];
const pill = heroOld.match(/        <div class="store-pill">[\s\S]*?<\/div>\n        <\/div>\n/)[0];
const formOld = heroOld.match(/        <form id="notify-form"[\s\S]*?<\/form>\n/)[0];
const success = heroOld.match(/        <div class="signup-success"[^\n]*\n/)[0];
const note = heroOld.match(/      <span class="region-note">[\s\S]*?<\/span>\n/)[0];
const form = formOld
  .replace('<form id="notify-form" name="notify"', '<form id="notify-form" hidden name="notify"')
  .replace(/          <p class="signup-note">[^\n]*\n/, '          <p class="signup-note">We’ll email you once when Local Pick is on the App Store. No spam.</p>\n');

rep(heroOld, `  <section class="hero">
    <div class="wrap hero-grid">
      <div class="hero-copy">
${note}      <h1>Find what's growing near you.</h1>
      <p class="tagline">Local Pick is a community-powered map for foragers to discover and share edible plants nearby — and know what's actually ripe right now.</p>

      <div class="store-row">
${playBtn}${pill}      </div>

      <div class="signup" id="notify">
        <button type="button" class="notify-toggle" id="notify-toggle" aria-expanded="false" aria-controls="notify-form">On iPhone? Get an email when it’s on the App Store</button>
${form}${success}      </div>
      </div>
      <div class="hero-shot">
        <div class="shot-frame"><img src="/assets/shot-map.webp" width="500" height="875" alt="The Local Pick map showing fruit trees and drinking water nearby" fetchpriority="high"></div>
        <div class="ripe-chips" aria-hidden="true">
          <span><i style="background:var(--ripe)"></i>Ripe</span>
          <span><i style="background:var(--almost)"></i>Almost ripe</span>
          <span><i style="background:var(--notripe)"></i>Not ripe</span>
        </div>
      </div>
    </div>
  </section>
`);

// About: text only now (the map screenshot moved up to the hero)
rep(/      <div class="shot-frame" style="max-width:250px;">\n        <img src="\/assets\/shot-map\.webp"[^\n]*\n      <\/div>\n/, '');
rep('  .about{display:grid; grid-template-columns:1fr; gap:32px; align-items:center;}',
    '  .about{max-width:760px; margin:0 auto; text-align:center;}\n  .about .callout{text-align:left;}');
rep('    .about{grid-template-columns:1.1fr 0.9fr;}\n', '');

// ---------- 7: colour in the feature icons and stat numbers
rep('  .feature-card h3{font-size:18px; margin-bottom:6px;}',
    '  .feature-icon.c-green{background:#E3EEDC; color:#2E7D32;}\n  .feature-icon.c-amber{background:#FDEFD9; color:#B26A00;}\n  .feature-icon.c-blue{background:#DDEEF8; color:#0277BD;}\n  .feature-icon.c-red{background:#F8E1DE; color:var(--red);}\n  .ripe-dots{display:flex; gap:6px; margin:10px 0 0;}\n  .ripe-dots i{width:10px; height:10px; border-radius:50%;}\n  .feature-card h3{font-size:18px; margin-bottom:6px;}');
const icons = ['c-green', 'c-amber', 'c-blue', 'c-red'];
let k = 0;
s = s.replace(/<div class="feature-icon">/g, () => `<div class="feature-icon ${icons[k++]}">`);
if (k !== 4) throw new Error('expected 4 feature icons, got ' + k);
rep(/(<h3>Real-time ripeness<\/h3>\n\s*<p>[^<]*<\/p>)/,
    '$1\n          <div class="ripe-dots" aria-hidden="true"><i style="background:var(--ripe)"></i><i style="background:var(--almost)"></i><i style="background:var(--notripe)"></i></div>');
rep('<h3>Badges & achievements</h3>', '<h3>Badges &amp; rewards</h3>');
rep('  .stat span{color:var(--muted); font-size:14px;}',
    '  .stat span{color:var(--muted); font-size:14px;}\n  .stat:nth-child(2) b{color:#0277BD;}\n  .stat:nth-child(3) b{color:#8A5A00;}\n  .stat:nth-child(4) b{color:var(--red);}');

// ---------- 6: six screenshots; a swipe row on phones
for (const shot of ['map', 'profile']) {
  rep(new RegExp(`        <div class="shot-card">\\n          <div class="shot-frame"><img src="/assets/shot-${shot}\\.webp"[\\s\\S]*?\\n        </div>\\n`), '');
}
rep('    .shots-grid{grid-template-columns:repeat(4,1fr); gap:32px 24px;}', '    .shots-grid{grid-template-columns:repeat(3,1fr); gap:36px 28px;}');
rep('    .shot-card p{font-size:12.5px;}\n  }',
    `    .shot-card p{font-size:12.5px;}
    .shots-grid{display:flex; overflow-x:auto; scroll-snap-type:x mandatory; gap:16px; margin:24px -24px 0; padding:4px 24px 18px; scrollbar-width:thin;}
    .shots-grid .shot-card{flex:0 0 64%; scroll-snap-align:center;}
    .swipe-hint{display:block !important;}
    .hero-shot{max-width:230px;}
    .ripe-chips{left:-28px; bottom:40px;}
  }
  @media(min-width:900px){
    .hero{padding:64px 0 72px;}
    .hero-grid{grid-template-columns:1.2fr 0.8fr; gap:56px;}
    .hero-copy{align-items:flex-start; text-align:left;}
    .hero .store-row{justify-content:flex-start;}
    .hero .signup{align-items:flex-start;}
  }`);
rep(/(<h2 style="text-align:center; font-size:32px;">A closer look<\/h2>\n)/,
    '$1      <p class="swipe-hint" style="display:none; text-align:center; color:var(--muted); font-size:13.5px; margin:-4px 0 0;">Swipe to see more →</p>\n');

// ---------- 5: closing download band
rep('  /* ---- Footer ---- */',
    `  /* ---- Closing call to action ---- */
  .cta-band{background:var(--green-dark); color:#E9EEDD; text-align:center; padding:64px 0;}
  .cta-band h2{color:#fff; font-size:34px;}
  .cta-band p{color:#CFD8BF; max-width:520px; margin:0 auto 22px; font-size:17px;}
  .cta-band .play-btn{box-shadow:none; border:1px solid rgba(255,255,255,0.25);}
  .cta-band .store-pill{background:transparent; border-color:rgba(255,255,255,0.35); color:#CFD8BF;}
  .cta-band .store-pill strong{color:#fff;}

  /* ---- Footer ---- */`);
rep('\n</main>', `
  <section class="cta-band" id="get-the-app">
    <div class="wrap">
      <h2>Find what's growing near you</h2>
      <p>Free to download. Join foragers mapping fruit, nuts, herbs and water around the world.</p>
      <div class="store-row">
${playBtn}${pill}      </div>
    </div>
  </section>

</main>`);
rep('  footer{padding:36px 0 28px; border-top:1px solid var(--border);}', '  footer{padding:36px 0 28px;}');

// ---------- 8: the iPhone email form opens from a link
rep("  var button = form.querySelector('button[type=\"submit\"]');",
    `  var button = form.querySelector('button[type="submit"]');
  var toggle = document.getElementById('notify-toggle');
  toggle.addEventListener('click', function () {
    form.hidden = false;
    toggle.hidden = true;
    toggle.setAttribute('aria-expanded', 'true');
    form.querySelector('input[type="email"]').focus();
  });`);

fs.writeFileSync(p, s);
console.log('ok');
