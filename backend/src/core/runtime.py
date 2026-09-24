"""Runtime detection: Cloudflare Python Workers run on Pyodide (``sys.platform == 'emscripten'``)."""

import sys

IN_WORKER = sys.platform == "emscripten"
