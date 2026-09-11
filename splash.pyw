import os
import threading
import webbrowser
import http.server
import socketserver
import tkinter as tk
from pathlib import Path

PORT = 8000
ROOT = Path(__file__).resolve().parent

def start_server():
    os.chdir(ROOT)
    handler = http.server.SimpleHTTPRequestHandler
    with socketserver.TCPServer(("127.0.0.1", PORT), handler) as httpd:
        webbrowser.open(f"http://127.0.0.1:{PORT}/index.html")
        httpd.serve_forever()

root = tk.Tk()
root.overrideredirect(True)
root.configure(bg="#101114")
root.geometry("240x240")
root.eval('tk::PlaceWindow . center')

try:
    img = tk.PhotoImage(file=ROOT / "assets" / "LOGO-DARKMODE-fit.png")
    label = tk.Label(root, image=img, bg="#101114")
    label.pack(expand=True)
except Exception:
    tk.Label(root, text="SCHEM", bg="#101114", fg="white", font=("Segoe UI", 18, "bold")).pack(expand=True)

threading.Thread(target=start_server, daemon=True).start()
root.after(1800, root.destroy)
root.mainloop()
