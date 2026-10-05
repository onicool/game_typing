"""Serve only the exported UI preview on loopback; reread it after edits."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PREVIEW = Path(__file__).with_name("angel-ui-preview.html")


class PreviewHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in ("/", "/index.html"):
            self.send_error(404)
            return
        content = PREVIEW.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 5186), PreviewHandler)
    print("http://127.0.0.1:5186/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
