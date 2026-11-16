(() => {
  'use strict';

  // Szerokość obrazu w "pikselach" na kolejnych poziomach (0 = pełna jakość).
  const LEVELS = [8, 12, 16, 24, 32, 48, 64, 96, 160, 0];
  const POINTS = [1000, 850, 700, 575, 450, 350, 250, 175, 100, 50];
  const LEVEL_TIME = 10000;      // ms do kolejnego wyostrzenia
  const FINAL_TIME = 20000;      // ms na ostatnim (pełnym) poziomie
  const ROUNDS = 10;
  const MAX_SUGGESTIONS = 8;

  // Podpowiedzi odkrywane na kolejnych poziomach (indeks w LEVELS).
  const HINTS = [
    { level: 3, label: 'Rok', value: (m) => m.year },
    { level: 5, label: 'Gatunek', value: (m) => (m.genres || []).slice(0, 2).join(', ') },
    { level: 7, label: 'Tytuł', value: (m) => titlePattern(m.title), mono: true },
  ];
  const BEST_STORAGE = 'movieGuesser.best';

  const { KeyError, getKey, saveKey } = window.Tmdb;
  const CATEGORIES = window.CATEGORIES || [];

  const $ = (id) => document.getElementById(id);
  const canvas = $('screen');
  const ctx = canvas.getContext('2d');
  const tiny = document.createElement('canvas');
  const tctx = tiny.getContext('2d');
  const overlay = $('overlay');
  const input = $('guess');
  const list = $('suggestions');
  const skipBtn = $('skip');
  const feedback = $('feedback');
  const history = $('history');

  function normalize(s) {
    return s
      .toLowerCase()
      .replace(/ł/g, 'l')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Wpis do podpowiedzi: { id, title, year, names[], keys[] }. Zgadnięcie = zgodne id.
  function makeEntry(id, title, year, aliases) {
    const names = [title];
    for (const a of aliases || []) if (a && !names.includes(a)) names.push(a);
    return { id, title, year, names, keys: names.map(normalize) };
  }

  // ---------- źródło: TMDB ----------

  function tmdbEntry(m) {
    const year = (m.release_date || '').slice(0, 4);
    return makeEntry('tmdb:' + m.id, m.title, year, [m.original_title]);
  }

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const tmdbSource = {
    curation: { movies: {} },

    // Filmy wykluczone w kuracji odpadają. Gdy w kategorii jest dość filmów z wybranymi
    // kadrami, gra losuje tylko spośród nich (pewne, charakterystyczne kadry).
    async movies(category) {
      const [found, curation, genres] = await Promise.all([
        Tmdb.discover(category),
        Tmdb.loadCuration(),
        Tmdb.genres().catch(() => ({})),
      ]);
      this.curation = curation;
      const movies = found
        .filter((m) => !curation.movies[m.id]?.excluded)
        .map((m) => ({
          ...tmdbEntry(m),
          tmdbId: m.id,
          backdrop: m.backdrop_path,
          genres: (m.genre_ids || []).map((id) => genres[id]).filter(Boolean),
          frames: curation.movies[m.id]?.frames || [],
        }));
      const curated = movies.filter((m) => m.frames.length);
      return curated.length >= ROUNDS ? curated : movies;
    },

    // Kadr z kuracji, a bez niej losowy backdrop bez napisów.
    async image(movie) {
      let path = movie.frames.length ? pick(movie.frames) : movie.backdrop;
      if (!movie.frames.length) {
        try {
          const frames = await Tmdb.backdrops(movie.tmdbId);
          if (frames.length) path = pick(frames).file_path;
        } catch (e) {
          if (e instanceof KeyError) throw e;
        }
      }
      return loadImage(Tmdb.imageUrl(path));
    },

    async search(query) {
      return (await Tmdb.search(query)).map(tmdbEntry);
    },
  };

  // ---------- źródło: lokalne pliki (movies.js + images/) ----------

  const localSource = {
    pool: [],

    async movies() {
      const loaded = await Promise.all((window.MOVIES || []).map(async (m) => {
        const img = await loadImage(m.image);
        return img && { ...makeEntry(localId(m.title, m.year), m.title, m.year, m.aliases), img };
      }));
      return loaded.filter(Boolean);
    },

    async image(movie) { return movie.img; },

    buildPool() {
      const byId = new Map();
      const all = [...(window.MOVIES || []), ...(window.EXTRA_TITLES || [])]
        .map((t) => (typeof t === 'string' ? { title: t } : t));
      for (const t of all) {
        const id = localId(t.title, t.year);
        const prev = byId.get(id);
        byId.set(id, makeEntry(id, t.title, t.year, [...(prev ? prev.names : []), ...(t.aliases || [])]));
      }
      this.pool = [...byId.values()];
    },
  };

  function localId(title, year) { return normalize(title) + '|' + (year || ''); }

  let source = localSource;

  // ---------- podpowiedzi ----------

  function rankEntry(entry, q) {
    let best = null;
    entry.keys.forEach((k, i) => {
      let rank;
      if (k === q) rank = 0;
      else if (k.startsWith(q)) rank = 1;
      else if (k.includes(' ' + q)) rank = 2;
      else if (k.includes(q)) rank = 3;
      else return;
      if (!best || rank < best.rank) best = { rank, name: entry.names[i] };
    });
    return best;
  }

  function searchLocal(query, pool) {
    const q = normalize(query);
    if (!q) return [];
    const out = [];
    for (const entry of pool) {
      const best = rankEntry(entry, q);
      if (best) out.push({ entry, ...best });
    }
    out.sort((a, b) => a.rank - b.rank || a.entry.title.localeCompare(b.entry.title));
    return out;
  }

  // Podświetla wpisany fragment (porównanie po normalizacji, więc działa bez polskich znaków).
  function highlight(name, query) {
    const q = normalize(query);
    const plain = Array.from(name).map((c) => normalize(c) || ' ');
    let flat = '';
    const map = [];
    plain.forEach((p, i) => { for (const ch of p) { flat += ch; map.push(i); } });
    const at = q ? flat.indexOf(q) : -1;
    if (at < 0) return escapeHtml(name);
    const chars = Array.from(name);
    const start = map[at];
    const end = map[at + q.length - 1] + 1;
    return escapeHtml(chars.slice(0, start).join('')) +
      '<mark>' + escapeHtml(chars.slice(start, end).join('')) + '</mark>' +
      escapeHtml(chars.slice(end).join(''));
  }

  let results = [];
  let active = -1;
  let searchTimer = null;
  let searchSeq = 0;

  function showResults(items) {
    results = items.slice(0, MAX_SUGGESTIONS);
    active = results.length ? 0 : -1;
    if (!results.length) { list.hidden = true; return; }
    list.innerHTML = results.map((r, i) => {
      const extra = r.name !== r.entry.title ? ` <span class="year">· ${escapeHtml(r.entry.title)}</span>` : '';
      const year = r.entry.year ? ` <span class="year">(${escapeHtml(r.entry.year)})</span>` : '';
      return `<li role="option" data-i="${i}">${highlight(r.name, input.value)}${year}${extra}</li>`;
    }).join('');
    list.hidden = false;
    markActive();
  }

  function onInput() {
    const query = input.value;
    clearTimeout(searchTimer);
    if (source === localSource) {
      showResults(searchLocal(query, localSource.pool));
      return;
    }
    if (normalize(query).length < 2) { closeSuggestions(); return; }
    const seq = ++searchSeq;
    searchTimer = setTimeout(async () => {
      try {
        const entries = await tmdbSource.search(query);
        if (seq !== searchSeq || !playing) return;
        const q = normalize(query);
        showResults(entries.map((entry) => ({ entry, ...(rankEntry(entry, q) || { rank: 9, name: entry.title }) })));
      } catch {
        if (seq === searchSeq) setFeedback('Nie udało się pobrać podpowiedzi z TMDB.', 'bad');
      }
    }, 250);
  }

  function markActive() {
    [...list.children].forEach((li, i) => li.classList.toggle('active', i === active));
    const el = list.children[active];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function closeSuggestions() {
    searchSeq++;
    list.hidden = true;
    results = [];
    active = -1;
  }

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault();
      active = (active + 1) % results.length;
      markActive();
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault();
      active = (active - 1 + results.length) % results.length;
      markActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0) submitGuess(results[active].entry);
      else if (input.value.trim()) setFeedback('Wybierz tytuł z listy podpowiedzi.', 'bad');
    } else if (e.key === 'Escape') {
      closeSuggestions();
    }
  });
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    submitGuess(results[+li.dataset.i].entry);
  });
  input.addEventListener('blur', () => setTimeout(closeSuggestions, 100));

  // ---------- obraz ----------

  function sizeCanvas(img) {
    canvas.width = 960;
    canvas.height = Math.round(960 * img.naturalHeight / img.naturalWidth);
  }

  function draw(img, levelIndex) {
    const w = LEVELS[levelIndex];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!w) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return;
    }
    const h = Math.max(1, Math.round(w * img.naturalHeight / img.naturalWidth));
    tiny.width = w;
    tiny.height = h;
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(img, 0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tiny, 0, 0, canvas.width, canvas.height);
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  // ---------- przebieg gry ----------

  const stage = document.querySelector('.stage');
  const ghost = $('ghost');
  const hintsEl = $('hints');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let category = null;
  let queue = [];
  let round = 0;
  let score = 0;
  let streak = 0;
  let log = [];                // przebieg gry: { title, year, won, points, level }
  let current = null;
  let currentImg = null;
  let nextImg = null;          // Promise z kadrem kolejnej rundy (ładowany w tle)
  let level = 0;
  let elapsed = 0;
  let lastTick = 0;
  let timer = null;
  let playing = false;

  // mode: 'menu' (zamiast obrazu), 'cover' (zasłania obraz), 'reveal' (podpis na odsłoniętym kadrze)
  function showOverlay(html, mode = 'menu') {
    overlay.innerHTML = html;
    overlay.className = 'overlay show ' + mode;
    stage.classList.toggle('menu', mode === 'menu');
    if (mode === 'menu') stage.classList.remove('won', 'lost');
  }
  function hideOverlay() {
    overlay.className = 'overlay';
    stage.classList.remove('menu');
  }

  function setFeedback(text, kind) {
    feedback.textContent = text;
    feedback.className = 'feedback' + (kind ? ' ' + kind : '');
  }

  function setPlaying(on) {
    playing = on;
    document.querySelector('.level').hidden = !on;
    input.disabled = !on;
    skipBtn.disabled = !on;
    if (!on) hintsEl.innerHTML = '';
  }

  // "Skazani na Shawshank" -> "S______ N_ S_______"
  function titlePattern(title) {
    return title.split(' ').map((word) => {
      let first = true;
      return Array.from(word).map((ch) => {
        if (!/[\p{L}\p{N}]/u.test(ch)) return ch;
        if (!first) return '_';
        first = false;
        return ch.toUpperCase();
      }).join('');
    }).join('  ');
  }

  function renderHints() {
    hintsEl.innerHTML = HINTS.filter((h) => h.value(current)).map((h) => {
      const left = h.level - level;
      const body = left <= 0
        ? `<b class="${h.mono ? 'mono' : ''}">${escapeHtml(h.value(current))}</b>`
        : `<i>za ${left} ${left === 1 ? 'poziom' : left < 5 ? 'poziomy' : 'poziomów'}</i>`;
      return `<li class="${left <= 0 ? 'open' : ''}"><span>${h.label}</span>${body}</li>`;
    }).join('');
  }

  function updateLevelUi() {
    const limit = level === LEVELS.length - 1 ? FINAL_TIME : LEVEL_TIME;
    $('level-fill').style.width = Math.min(100, elapsed / limit * 100) + '%';
    const w = LEVELS[level];
    const res = w ? `${w}×${Math.max(1, Math.round(w * currentImg.naturalHeight / currentImg.naturalWidth))}` : 'pełna jakość';
    $('level-label').textContent = `${res} · ${POINTS[level]} pkt`;
  }

  // Zostawia poprzedni obraz na wierzchu i płynnie go wygasza (przejście między poziomami).
  function fadeFromCurrent() {
    ghost.width = canvas.width;
    ghost.height = canvas.height;
    ghost.getContext('2d').drawImage(canvas, 0, 0);
    ghost.style.transition = 'none';
    ghost.style.opacity = 1;
    void ghost.offsetWidth;
    ghost.style.transition = '';
    ghost.style.opacity = 0;
  }

  function setLevel(i) {
    if (i > 0) fadeFromCurrent();
    level = i;
    elapsed = 0;
    draw(currentImg, level);
    updateLevelUi();
    renderHints();
  }

  function nextLevel() {
    if (level < LEVELS.length - 1) setLevel(level + 1);
    else endRound(false);
  }

  function tick(now) {
    if (!playing) return;
    // Ograniczenie skoku: po powrocie z innej karty czas nie przeskakuje kilku poziomów.
    elapsed += Math.min(now - lastTick, 250);
    lastTick = now;
    const limit = level === LEVELS.length - 1 ? FINAL_TIME : LEVEL_TIME;
    if (elapsed >= limit) nextLevel();
    if (playing) {
      updateLevelUi();
      timer = requestAnimationFrame(tick);
    }
  }

  // Ładuje kadr dla filmu z kolejki; filmy bez działającego kadru są wyrzucane.
  async function fetchImage(index) {
    while (index < queue.length) {
      const img = await source.image(queue[index]);
      if (img) return img;
      queue.splice(index, 1);
    }
    return null;
  }

  async function startRound() {
    showOverlay('<h2>Ładowanie kadru…</h2>', round ? 'cover' : 'menu');
    let img;
    try {
      img = await (nextImg || fetchImage(round));
    } catch (e) {
      return showError(e);
    }
    nextImg = null;
    if (!img) return endGame();
    current = queue[round];
    currentImg = img;
    round++;
    $('round').textContent = `${round}/${queue.length}`;
    history.innerHTML = '';
    setFeedback('');
    input.value = '';
    stage.classList.remove('won', 'lost');
    hideOverlay();
    sizeCanvas(currentImg);
    setLevel(0);
    setPlaying(true);
    renderHints();
    input.focus();
    lastTick = performance.now();
    timer = requestAnimationFrame(tick);
    if (round < queue.length) {
      nextImg = fetchImage(round);
      nextImg.catch(() => {});
    }
  }

  // Po trafieniu kadr szybko "wywołuje się" poziom po poziomie; po porażce po prostu się wyostrza.
  async function reveal(stepwise) {
    const last = LEVELS.length - 1;
    if (stepwise) {
      for (let i = level + 1; i < last; i++) {
        draw(currentImg, i);
        await sleep(70);
      }
    }
    fadeFromCurrent();
    draw(currentImg, last);
    await sleep(450);
  }

  async function endRound(won) {
    setPlaying(false);
    cancelAnimationFrame(timer);
    closeSuggestions();
    const points = won ? POINTS[level] : 0;
    score += points;
    streak = won ? streak + 1 : 0;
    log.push({ title: current.title, year: current.year, won, points, level });
    $('score').textContent = score;
    setFeedback('');
    stage.classList.add(won ? 'won' : 'lost');
    await reveal(won);
    const last = round >= queue.length;
    const year = current.year ? ` (${escapeHtml(current.year)})` : '';
    const original = current.names[1] ? `<br><span>${escapeHtml(current.names[1])}</span>` : '';
    showOverlay(`
      <h2 class="${won ? 'good' : ''}">${won ? 'Brawo! +' + points + ' pkt' : 'Nie tym razem'}</h2>
      <p>To był film <b>${escapeHtml(current.title)}</b>${year}${original}</p>
      ${streak >= 2 ? `<p class="streak">${streak} ${streak < 5 ? 'trafienia' : 'trafień'} z rzędu</p>` : ''}
      <button class="primary" id="next">${last ? 'Zobacz wynik' : 'Następny film'}</button>`, 'reveal');
    $('next').onclick = last ? endGame : startRound;
    $('next').focus();
  }

  // ---------- rekordy i podsumowanie ----------

  function readBest() {
    try { return JSON.parse(localStorage.getItem(BEST_STORAGE)) || {}; } catch { return {}; }
  }
  function getBest(id) { return readBest()[id] || 0; }
  function setBest(id, value) {
    try { localStorage.setItem(BEST_STORAGE, JSON.stringify({ ...readBest(), [id]: value })); } catch { /* bez zapisu */ }
  }

  function verdict(hits, total) {
    const ratio = total ? hits / total : 0;
    if (ratio >= 0.9) return 'Kinoman absolutny!';
    if (ratio >= 0.6) return 'Świetny seans!';
    if (ratio >= 0.3) return 'Niezły wynik';
    return 'Następnym razem pójdzie lepiej';
  }

  // Zielony = trafione wcześnie, żółty = trafione później, czerwony = pudło.
  function shareText(max) {
    const squares = log.map((r) => (!r.won ? '🟥' : r.level <= 3 ? '🟩' : '🟨')).join('');
    return `Movie Guesser${category ? ' · ' + category.name : ''}\n${squares}\n${score}/${max} pkt`;
  }

  function endGame() {
    setPlaying(false);
    const max = log.length * POINTS[0];
    const hits = log.filter((r) => r.won).length;
    const bestId = category ? category.id : 'local';
    const best = getBest(bestId);
    if (score > best) setBest(bestId, score);
    const record = score > best && best > 0
      ? '<p class="record">Nowy rekord!</p>'
      : best > score ? `<p class="small">Twój rekord: ${best} pkt</p>` : '';
    showOverlay(`
      <h2>${verdict(hits, log.length)}</h2>
      <p class="final"><b>${score}</b> / ${max} pkt · trafione ${hits} z ${log.length}</p>
      ${record}
      <ol class="summary">
        ${log.map((r) => `
          <li class="${r.won ? 'hit' : 'miss'}">
            <span>${escapeHtml(r.title)}${r.year ? ` <i>${escapeHtml(r.year)}</i>` : ''}</span>
            <b>${r.won ? '+' + r.points : '—'}</b>
          </li>`).join('')}
      </ol>
      <div class="actions">
        <button class="primary" id="again">Zagraj ponownie</button>
        ${source === tmdbSource ? '<button type="button" id="change">Zmień kategorię</button>' : ''}
        <button type="button" id="share">Skopiuj wynik</button>
      </div>
      ${settingsLink()}`);
    $('again').onclick = () => newGame(category);
    if ($('change')) $('change').onclick = showStart;
    $('share').onclick = async () => {
      try {
        await navigator.clipboard.writeText(shareText(max));
        $('share').textContent = 'Skopiowano!';
      } catch {
        $('share').textContent = 'Nie udało się skopiować';
      }
    };
    bindSettings();
    $('again').focus();
  }

  async function newGame(cat) {
    category = cat;
    $('cat').textContent = category ? category.name : '';
    showOverlay('<h2>Losowanie filmów…</h2>');
    try {
      const movies = await source.movies(category);
      if (!movies.length) throw new Error(source === localSource ? 'Brak kadrów – wrzuć je do folderu images/ i wpisz w movies.js.' : 'TMDB nie zwróciło filmów.');
      queue = shuffle(movies).slice(0, ROUNDS);
    } catch (e) {
      return showError(e);
    }
    round = 0;
    score = 0;
    streak = 0;
    log = [];
    nextImg = null;
    $('score').textContent = '0';
    startRound();
  }

  function submitGuess(entry) {
    if (!playing) return;
    closeSuggestions();
    input.value = '';
    if (entry.id === current.id) {
      endRound(true);
      return;
    }
    const li = document.createElement('li');
    li.textContent = entry.title;
    history.appendChild(li);
    setFeedback(`To nie „${entry.title}”. Obraz robi się wyraźniejszy…`, 'bad');
    input.classList.remove('shake');
    void input.offsetWidth;
    input.classList.add('shake');
    nextLevel();
  }

  skipBtn.addEventListener('click', () => {
    if (!playing) return;
    nextLevel();
    input.focus();
  });

  // ---------- ekrany startowe ----------

  function showError(e) {
    setPlaying(false);
    if (e instanceof KeyError) {
      saveKey('');
      return showKeyForm('Ten klucz nie działa – sprawdź go i wklej ponownie.');
    }
    showOverlay(`
      <h2>Coś poszło nie tak</h2>
      <p>${escapeHtml(e.message || e)}</p>
      <button class="primary" id="retry">Spróbuj ponownie</button>
      ${settingsLink()}`);
    $('retry').onclick = () => init();
    bindSettings();
  }

  function settingsLink() {
    return '<button type="button" class="link" id="settings">Ustawienia TMDB</button>';
  }
  function bindSettings() {
    const btn = $('settings');
    if (btn) btn.onclick = () => showKeyForm();
  }

  function showKeyForm(error) {
    setPlaying(false);
    const hasLocal = localSource.pool.length && (window.MOVIES || []).length;
    showOverlay(`
      <h2>Klucz TMDB</h2>
      <p>Kadry i tytuły pobierane są z bazy <b>The Movie Database</b>. Załóż darmowe konto i skopiuj
      klucz z <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">themoviedb.org/settings/api</a>
      („API Key” albo „API Read Access Token”).</p>
      <form id="key-form" class="key-form">
        <input id="key-input" type="password" placeholder="Wklej klucz TMDB" autocomplete="off" value="${escapeHtml(getKey())}">
        <button class="primary" type="submit">Zapisz</button>
      </form>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      <p class="small">Klucz zostaje tylko w tej przeglądarce.</p>
      ${getKey() ? '<button type="button" class="link" id="forget">Usuń zapisany klucz</button>' : ''}
      ${hasLocal ? '<button type="button" class="link" id="local">Graj na własnych kadrach (folder images/)</button>' : ''}`);
    $('key-form').onsubmit = (e) => {
      e.preventDefault();
      saveKey($('key-input').value.trim());
      init();
    };
    if ($('forget')) $('forget').onclick = () => { saveKey(''); showKeyForm(); };
    if ($('local')) $('local').onclick = () => { source = localSource; showStart(); };
    $('key-input').focus();
  }

  function showStart() {
    const intro = `<h2>Zgadnij film</h2>
      <p>Kadr zaczyna od ${LEVELS[0]} pikseli szerokości i co ${LEVEL_TIME / 1000} s robi się wyraźniejszy.
      Im szybciej zgadniesz, tym więcej punktów. Z czasem dostaniesz podpowiedzi: rok, gatunek i litery tytułu.</p>`;
    if (source === localSource) {
      showOverlay(`${intro}
        <p>Grasz na własnych kadrach z folderu images/.</p>
        <button class="primary" id="start">Start</button>
        ${settingsLink()}`);
      $('start').onclick = () => newGame(null);
    } else {
      showOverlay(`${intro}
        <div class="categories">
          ${CATEGORIES.map((c, i) => `
            <button type="button" class="category" data-i="${i}">
              <b>${escapeHtml(c.name)}</b>
              <span>${escapeHtml(c.description)}</span>
              ${getBest(c.id) ? `<i>Rekord: ${getBest(c.id)} pkt</i>` : ''}
            </button>`).join('')}
        </div>
        <a class="small" href="curate.html">Kuracja kadrów</a>
        ${settingsLink()}`);
      overlay.querySelectorAll('.category').forEach((btn) => {
        btn.onclick = () => newGame(CATEGORIES[+btn.dataset.i]);
      });
    }
    bindSettings();
  }

  function init() {
    setPlaying(false);
    if (!localSource.pool.length) localSource.buildPool();
    if (getKey()) {
      source = tmdbSource;
      showStart();
    } else {
      source = localSource;
      showKeyForm();
    }
  }

  init();
})();
