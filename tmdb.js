// Wspólny klient TMDB dla gry (game.js) i narzędzia do kuracji kadrów (curate.js).
window.Tmdb = (() => {
  'use strict';

  const API = 'https://api.themoviedb.org/3';
  const IMG = 'https://image.tmdb.org/t/p/';
  const LANG = 'pl-PL';
  const KEY_STORAGE = 'movieGuesser.tmdbKey';

  class KeyError extends Error {}

  function getKey() {
    if (window.TMDB_KEY) return window.TMDB_KEY;
    try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
  }

  function saveKey(key) {
    try {
      if (key) localStorage.setItem(KEY_STORAGE, key);
      else localStorage.removeItem(KEY_STORAGE);
    } catch { /* tryb prywatny – klucz tylko na tę sesję */ }
    window.TMDB_KEY = key;
  }

  // Obsługuje oba rodzaje kluczy: krótki "API Key" i długi "Read Access Token".
  async function request(path, params = {}) {
    const key = getKey();
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const headers = {};
    if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;
    else url.searchParams.set('api_key', key);
    const res = await fetch(url, { headers });
    if (res.status === 401) throw new KeyError('Nieprawidłowy klucz TMDB');
    if (!res.ok) throw new Error('TMDB: ' + res.status);
    return res.json();
  }

  // Filmy z kategorii (categories.js), w kolejności rankingu, tylko z kadrem.
  async function discover(category) {
    const pages = [...Array(Math.ceil(category.size / 20))].map((_, i) => i + 1);
    const data = await Promise.all(pages.map((page) => request('/discover/movie', {
      language: LANG,
      include_adult: 'false',
      ...category.params,
      page,
    })));
    const seen = new Set();
    return data.flatMap((d) => d.results)
      .filter((m) => m.backdrop_path && !seen.has(m.id) && seen.add(m.id))
      .slice(0, category.size);
  }

  // Kadry bez napisów (backdropy bez języka), najwyżej oceniane najpierw.
  async function backdrops(movieId) {
    const data = await request(`/movie/${movieId}/images`, { include_image_language: 'null' });
    return (data.backdrops || []).filter((b) => !b.iso_639_1);
  }

  async function search(query) {
    const data = await request('/search/movie', { query, language: LANG, include_adult: 'false' });
    return data.results.sort((a, b) => b.popularity - a.popularity);
  }

  // Słownik gatunków { id: nazwa }, pobierany raz.
  let genreMap = null;
  async function genres() {
    if (!genreMap) {
      const data = await request('/genre/movie/list', { language: LANG });
      genreMap = Object.fromEntries(data.genres.map((g) => [g.id, g.name]));
    }
    return genreMap;
  }

  function imageUrl(path, size = 'w1280') {
    return IMG + size + path;
  }

  // Kuracja: { movies: { [tmdbId]: { title, frames: [file_path…], excluded } } }
  async function loadCuration() {
    try {
      const res = await fetch('curated.json', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.movies) return data;
      }
    } catch { /* brak pliku = brak kuracji */ }
    return { movies: {} };
  }

  return { KeyError, getKey, saveKey, request, discover, backdrops, search, genres, imageUrl, loadCuration };
})();
