// Kategorie gry. `params` trafiają prosto do TMDB /discover/movie
// (https://developer.themoviedb.org/reference/discover-movie), `size` = ile filmów w puli.
window.CATEGORIES = [
  {
    id: 'top100',
    name: 'Top 100',
    description: 'Najlepiej oceniane filmy wszech czasów',
    size: 100,
    params: { sort_by: 'vote_average.desc', 'vote_count.gte': 5000 },
  },
  {
    id: 'animation',
    name: 'Animacje',
    description: 'Najbardziej znane filmy animowane',
    size: 60,
    params: { with_genres: 16, sort_by: 'vote_count.desc' },
  },
  {
    id: 'horror',
    name: 'Horrory',
    description: 'Znane horrory',
    size: 60,
    params: { with_genres: 27, sort_by: 'vote_count.desc' },
  },
  {
    id: 'christmas',
    name: 'Filmy świąteczne',
    description: 'Klasyki na Boże Narodzenie',
    size: 40,
    params: { with_keywords: 207317, sort_by: 'vote_count.desc' },
  },
];
