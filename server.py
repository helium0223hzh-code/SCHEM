import http.server
import socketserver
import webbrowser
import os
import urllib.parse
import subprocess

PORT = 8000

os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/open-location":
            query = urllib.parse.parse_qs(parsed.query)
            path = query.get("path", [""])[0]
            try:
                if path and os.path.isdir(path):
                    subprocess.Popen(["explorer", os.path.normpath(path)])
                elif path and os.path.exists(path):
                    subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
                elif path:
                    parent = os.path.dirname(path)
                    if parent and os.path.isdir(parent):
                        subprocess.Popen(["explorer", os.path.normpath(parent)])
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write("ok".encode("utf-8"))
                return
            except Exception as exc:
                self.send_response(500)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write(str(exc).encode("utf-8"))
                return
        super().do_GET()

handler = Handler

with socketserver.TCPServer(("127.0.0.1", PORT), handler) as httpd:
    url = f"http://127.0.0.1:{PORT}/index.html"
    print(f"SCHEM Workbench is running at {url}")
    webbrowser.open(url)
    httpd.serve_forever()
