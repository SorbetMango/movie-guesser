(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const CATEGORIES = window.CATEGORIES || [];

  let curation = { movies: {} };
  let movies = [];          // filmy bieżącej kategorii z TMDB
  let visible = [];         // po filtrze
  let current = null;
  let loadSeq = 0;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function setStatus(text, bad) {
    $('status').textContent = text;
    $('status').className = bad ? 'bad' : '';
  }

  // ---------- zapis ----------

  let saveTimer = null;

  function entryFor(movie) {
    return curation.movies[movie.id] || { frames: [], excluded: false };
  }

  function updateEntry(movie, change) {
    const entry = { ...entryFor(movie), ...change, title: movie.title, year: year(movie) };
    if (!entry.frames.length && !entry.excluded) delete curation.movies[movie.id];
    else curation.movies[movie.id] = entry;
    renderList();
    scheduleSave();
  }

  function scheduleSave() {
    setStatus('Zapisywanie…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const res = await fetch('api/curation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(curation),
        });
        if (!res.ok) throw new Error(res.status);
        setStatus('Zapisano');
      } catch {
        setStatus('Nie zapisano – uruchom grę przez „python server.py”', true);
      }
    }, 400);
  }

  // ---------- lista filmów ----------

  const year = (m) => (m.release_date || '').slice(0, 4);

  function matchesFilter(m) {
    const e = entryFor(m);
    switch ($('filter').value) {
      case 'todo': return !e.excluded && !e.frames.length;
      case 'done': return e.frames.length > 0;
      case 'excluded': return e.excluded;
      default: return true;
    }
  }

  function renderList() {
    visible = movies.filter(matchesFilter);
    const done = movies.filter((m) => entryFor(m).frames.length && !entryFor(m).excluded).length;
    $('movies').innerHTML = visible.map((m, i) => {
      const e = entryFor(m);
      const badge = e.excluded ? '<span class="badge">poza grą</span>'
        : `<span class="badge ${e.frames.length ? 'ok' : ''}">${e.frames.length}</span>`;
      const cls = [current && current.id === m.id ? 'active' : '', e.excluded ? 'excluded' : ''].join(' ');
      return `<li class="${cls}" data-i="${i}"><span>${escapeHtml(m.title)} <span class="badge">${year(m)}</span></span>${badge}</li>`;
    }).join('') || '<li>Brak filmów</li>';
    setStatus(`${done}/${movies.length} filmów z kadrami`);
    const active = $('movies').querySelector('.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  $('movies').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) selectMovie(visible[+li.dataset.i]);
  });

  async function loadCategory() {
    const category = CATEGORIES[+$('category').value];
    setStatus('Ładowanie…');
    try {
      movies = await Tmdb.discover(category);
    } catch (e) {
      setStatus(e instanceof Tmdb.KeyError ? 'Brak lub zły klucz TMDB w config.js' : 'Błąd TMDB', true);
      return;
    }
    current = null;
    renderList();
    if (visible.length) selectMovie(visible[0]);
  }

  // ---------- kadry ----------

  function drawPixel(frame) {
    const img = frame.querySelector('img');
    const canvas = frame.querySelector('canvas');
    const w = +$('pixel').value;
    canvas.hidden = !w;
    if (!w || !img.complete || !img.naturalWidth) return;
    const h = Math.max(1, Math.round(w * img.naturalHeight / img.naturalWidth));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
  }

  async function selectMovie(movie) {
    if (!movie) return;
    current = movie;
    const seq = ++loadSeq;
    renderList();
    $('movie-title').textContent = `${movie.title} (${year(movie)})`;
    $('exclude').hidden = false;
    renderExclude();
    $('frames').innerHTML = '<p class="empty">Ładowanie kadrów…</p>';
    let frames;
    try {
      frames = await Tmdb.backdrops(movie.id);
    } catch {
      if (seq === loadSeq) $('frames').innerHTML = '<p class="empty">Nie udało się pobrać kadrów.</p>';
      return;
    }
    if (seq !== loadSeq) return;
    // Wybrane kadry zawsze na górze, nawet gdyby zniknęły z listy TMDB.
    const chosen = entryFor(movie).frames;
    const paths = [...chosen, ...frames.map((f) => f.file_path).filter((p) => !chosen.includes(p))];
    if (!paths.length) {
      $('frames').innerHTML = '<p class="empty">TMDB nie ma kadrów bez napisów dla tego filmu.</p>';
      return;
    }
    $('frames').innerHTML = paths.map((p) => `
      <button type="button" class="frame ${chosen.includes(p) ? 'on' : ''}" data-path="${escapeHtml(p)}">
        <img loading="lazy" src="${Tmdb.imageUrl(p, 'w300')}" alt="">
        <canvas hidden></canvas>
        <span class="tag">w grze</span>
      </button>`).join('');
    $('frames').querySelectorAll('.frame').forEach((frame) => {
      frame.querySelector('img').addEventListener('load', () => drawPixel(frame));
    });
  }

  $('frames').addEventListener('click', (e) => {
    const frame = e.target.closest('.frame');
    if (!frame || !current) return;
    const path = frame.dataset.path;
    const frames = [...entryFor(current).frames];
    const at = frames.indexOf(path);
    if (at >= 0) frames.splice(at, 1);
    else frames.push(path);
    frame.classList.toggle('on', at < 0);
    updateEntry(current, { frames });
  });

  function renderExclude() {
    $('exclude').textContent = entryFor(current).excluded ? 'Przywróć do gry' : 'Wyklucz z gry';
  }

  $('exclude').addEventListener('click', () => {
    if (!current) return;
    updateEntry(current, { excluded: !entryFor(current).excluded });
    renderExclude();
  });

  $('next-todo').addEventListener('click', () => {
    const start = movies.indexOf(current);
    const rest = [...movies.slice(start + 1), ...movies.slice(0, start + 1)];
    const next = rest.find((m) => !entryFor(m).excluded && !entryFor(m).frames.length);
    if (next) {
      if (!visible.includes(next)) $('filter').value = 'all';
      selectMovie(next);
    } else {
      setStatus('Wszystkie filmy mają kadry');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT' || !visible.length) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const at = visible.indexOf(current);
    const next = e.key === 'ArrowDown' ? Math.min(visible.length - 1, at + 1) : Math.max(0, at - 1);
    selectMovie(visible[next]);
  });

  $('filter').addEventListener('change', renderList);
  $('category').addEventListener('change', loadCategory);
  $('pixel').addEventListener('change', () => $('frames').querySelectorAll('.frame').forEach(drawPixel));

  async function init() {
    $('category').innerHTML = CATEGORIES.map((c, i) => `<option value="${i}">${escapeHtml(c.name)}</option>`).join('');
    curation = await Tmdb.loadCuration();
    loadCategory();
  }

  init();
})();
