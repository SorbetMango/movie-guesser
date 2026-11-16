"""Lokalny serwer gry: serwuje pliki i zapisuje kurację kadrów do curated.json.

Uruchom:  python server.py   ->  http://localhost:8123
"""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get('PORT', 8123))
ROOT = os.path.dirname(os.path.abspath(__file__))
CURATED = os.path.join(ROOT, 'curated.json')


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # Bez cache, żeby zmiany w plikach i kuracji były widoczne od razu.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        if self.path != '/api/curation':
            self.send_error(404)
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError('expected object')
        except (ValueError, json.JSONDecodeError) as e:
            self.send_error(400, str(e))
            return
        tmp = CURATED + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, CURATED)
        self.send_response(204)
        self.end_headers()


if __name__ == '__main__':
    print(f'Movie Guesser: http://localhost:{PORT}  (kuracja: http://localhost:{PORT}/curate.html)')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
