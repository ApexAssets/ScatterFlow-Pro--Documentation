// Smart search: Ctrl+K (or the search box) opens it.
// Results come at once from a keyword match; when the small language model has loaded (once,
// then cached by the browser) they are ranked by meaning as well, so a question in plain words
// finds the right card even when it uses none of the card's words.
const MODEL_LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
const MAX_RESULTS = 12;

let index = null;
let vecs = null;
let embedder = null;
let modelState = 'idle';          // idle | loading | ready | failed
let lastQuery = '';
let selected = 0;
let results = [];

// ---------------------------------------------------------------- UI
const box = document.createElement('div');
box.className = 'search-box';
box.innerHTML = `
  <div class="search-panel" role="dialog" aria-modal="true" aria-label="Search the documentation">
    <div class="search-field">
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input type="search" placeholder="Search or ask, e.g. &quot;keep trees off steep slopes&quot;" autocomplete="off" spellcheck="false">
      <kbd>Esc</kbd>
    </div>
    <div class="search-status"><span class="dot"></span><span class="msg">Smart search: loading</span></div>
    <div class="search-results"></div>
    <div class="search-hint"><span>&uarr; &darr; to choose</span><span>Enter to open</span></div>
  </div>`;
document.body.appendChild(box);
const input = box.querySelector('input');
const list = box.querySelector('.search-results');
const status = box.querySelector('.search-status');

function setStatus() {
  const msg = status.querySelector('.msg');
  status.classList.toggle('ready', modelState === 'ready');
  if (modelState === 'ready') msg.textContent = 'Smart search on: results are matched by meaning and by words';
  else if (modelState === 'failed') msg.textContent = 'Word search (smart search could not load in this browser)';
  else msg.textContent = 'Word search now; smart search is loading (only the first time)';
}

function open() {
  box.classList.add('open');
  document.body.style.overflow = 'hidden';
  input.focus();
  input.select();
  load();
}

function close() {
  box.classList.remove('open');
  document.body.style.overflow = '';
}

document.querySelectorAll('.search-open').forEach(b => b.addEventListener('click', open));
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); }
  else if (e.key === '/' && !box.classList.contains('open') && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); open(); }
  else if (e.key === 'Escape' && box.classList.contains('open')) close();
});
box.addEventListener('click', e => { if (e.target === box) close(); });

input.addEventListener('input', () => search(input.value));
input.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); select(selected + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); select(selected - 1); }
  else if (e.key === 'Enter' && results[selected]) { e.preventDefault(); go(results[selected]); }
});

function select(i) {
  const items = list.querySelectorAll('.result');
  if (!items.length) return;
  selected = (i + items.length) % items.length;
  items.forEach((el, k) => el.classList.toggle('sel', k === selected));
  items[selected].scrollIntoView({ block: 'nearest' });
}

function go(card) {
  const here = location.pathname.split('/').pop() || 'index.html';
  close();
  if (here === card.p) {
    location.hash = card.a;
    flash(card.a);
  } else {
    location.href = card.p + '#' + card.a;
  }
}

function flash(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 2500);
}

// ---------------------------------------------------------------- data
async function load() {
  if (!index) {
    const res = await fetch('search-index.json', { cache: 'no-cache' });
    index = await res.json();
    const bytes = Uint8Array.from(atob(index.vecs), c => c.charCodeAt(0));
    vecs = new Int8Array(bytes.buffer);
    index.cards.forEach(c => {
      c._title = c.t.toLowerCase();
      c._where = (c.s + ' ' + c.pt).toLowerCase();
      c._text = c.x.toLowerCase();
    });
    if (input.value) search(input.value);
  }
  if (modelState === 'idle') {
    modelState = 'loading';
    setStatus();
    try {
      const { pipeline } = await import(MODEL_LIB);
      embedder = await pipeline('feature-extraction', index.model, { dtype: 'q8' });
      modelState = 'ready';
    } catch (err) {
      console.warn('Smart search unavailable:', err);
      modelState = 'failed';
    }
    setStatus();
    if (input.value) search(input.value);
  }
}

// ---------------------------------------------------------------- ranking
const STOP = new Set('a an and are as at be by can do does for from how i in is it its me my of on or the this to what when where which why with you your'.split(' '));

function words(q) {
  return q.toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w));
}

function keywordScore(c, ws, phrase) {
  if (!ws.length) return 0;
  let s = 0;
  for (const w of ws) {
    const re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (re.test(c._title)) s += 3;
    else if (re.test(c._where)) s += 1.5;
    if (re.test(c._text)) s += 1;
  }
  if (phrase.length > 3 && c._title.includes(phrase)) s += 4;
  return s / (ws.length * 5);
}

async function search(q) {
  lastQuery = q;
  q = q.trim();
  if (!index) return;
  if (!q) { list.innerHTML = ''; results = []; return; }
  const ws = words(q);
  const phrase = q.toLowerCase();
  let sem = null;
  if (modelState === 'ready') {
    const out = await embedder(QUERY_PREFIX + q, { pooling: 'cls', normalize: true });
    if (q !== lastQuery.trim()) return;          // a newer query is on its way
    sem = out.data;
  }
  const d = index.dims;
  const scored = index.cards.map((c, i) => {
    const kw = keywordScore(c, ws, phrase);
    let s = kw;
    if (sem) {
      let dot = 0;
      for (let k = 0; k < d; k++) dot += sem[k] * vecs[i * d + k];
      s = dot / 127 + 0.25 * kw;
    }
    return [s, kw, c];
  });
  scored.sort((a, b) => b[0] - a[0]);
  const top = scored.filter(([s, kw]) => sem ? s > 0.55 : kw > 0).slice(0, MAX_RESULTS);
  results = top.map(r => r[2]);
  render(ws);
}

// ---------------------------------------------------------------- results
function esc(s) {
  return s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function highlight(text, ws) {
  let out = esc(text);
  for (const w of ws) {
    if (w.length < 3) continue;
    out = out.replace(new RegExp('\\b(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[a-z]*)', 'gi'), '<mark>$1</mark>');
  }
  return out;
}

function snippet(text, ws) {
  const low = text.toLowerCase();
  let at = -1;
  for (const w of ws) { const i = low.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
  const start = Math.max(0, at - 60);
  return (start ? '... ' : '') + text.slice(start, start + 220) + (text.length > start + 220 ? ' ...' : '');
}

function render(ws) {
  selected = 0;
  if (!results.length) {
    list.innerHTML = '<div class="search-empty">Nothing found. Try other words, or describe what you want to do.</div>';
    return;
  }
  list.innerHTML = results.map((c, i) => `
    <a class="result${i === 0 ? ' sel' : ''}" href="${c.p}#${c.a}">
      ${c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy">` : '<span class="noimg"></span>'}
      <span>
        <span class="where">${esc(c.pt)}${c.s && c.s !== c.t ? ' &rsaquo; ' + esc(c.s) : ''}</span>
        <span class="title">${highlight(c.t, ws)}</span>
        <span class="snip">${highlight(snippet(c.x, ws), ws)}</span>
      </span>
    </a>`).join('');
  list.querySelectorAll('.result').forEach((el, i) => el.addEventListener('click', e => {
    e.preventDefault();
    go(results[i]);
  }));
}

if (location.hash) setTimeout(() => flash(location.hash.slice(1)), 300);
setStatus();
