# Movie Guesser

Zgadnij film po mocno zapikselowanym kadrze. Obraz zaczyna od 8 pikseli szerokości
i z czasem się wyostrza, a po drodze odkrywają się podpowiedzi: rok, gatunek i litery tytułu.

## Uruchomienie lokalnie

```bash
python server.py
```

Gra: http://localhost:8123 · wybór kadrów: http://localhost:8123/curate.html

## Pliki

- `categories.js` – kategorie gry (parametry wyszukiwania TMDB)
- `config.js` – klucz API TMDB
- `curate.html` – narzędzie do wybierania kadrów; zapisuje `curated.json` (wymaga `server.py`)
- `movies.js` + `images/` – opcjonalny tryb na własnych kadrach

Dane i kadry: [TMDB](https://www.themoviedb.org/). Ta gra korzysta z API TMDB, ale nie jest
wspierana ani certyfikowana przez TMDB.
