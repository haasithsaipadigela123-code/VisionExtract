"""
Vision Extract - Flask backend.

OCR runs in the BROWSER with Tesseract.js — exactly like the video extractor —
so there is nothing to install (no Tesseract program, no OpenCV). The browser
samples video frames, reads the text on each one, and sends the recognised
per-frame text here as JSON. Python then runs the pattern extraction.

Routes:
  GET  /          -> the single-page UI
  POST /extract   -> JSON: { frames: [{frame, timestamp, text, confidence}],
                            kind, filename }  ->  structured result as JSON
"""

import os
import sys

from flask import Flask, request, jsonify, render_template

import extractor

# Anchor root path explicitly to the directory containing this script.
# This ensures template_folder and static_folder resolve correctly regardless of
# the current working directory from which python is invoked.
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "templates"),
    static_folder=os.path.join(BASE_DIR, "static"),
)

# The request body is just text now, so a small cap is plenty.
app.config["MAX_CONTENT_LENGTH"] = 12 * 1024 * 1024


@app.route("/")
def index():
    return render_template(
        "index.html",
        categories=extractor.CATEGORY_LABELS,
        order=extractor.CATEGORY_ORDER,
    )


@app.route("/extract", methods=["POST"])
def extract():
    payload = request.get_json(silent=True)
    if not payload or "frames" not in payload:
        return jsonify({"error": "No OCR text was received."}), 400

    raw_frames = payload.get("frames")
    if not isinstance(raw_frames, list) or not raw_frames:
        return jsonify({"error": "No readable text was found in that file."}), 400

    frames = []
    for fr in raw_frames:
        if not isinstance(fr, dict):
            continue
        try:
            frames.append(
                {
                    "frame": int(fr.get("frame", 1)),
                    "timestamp": float(fr.get("timestamp", 0.0)),
                    "text": str(fr.get("text", "")),
                    "confidence": float(fr.get("confidence", 0.0)),
                }
            )
        except (TypeError, ValueError):
            continue

    result = extractor.build_results(frames)
    result["kind"] = "video" if payload.get("kind") == "video" else "image"
    result["frames_scanned"] = len(frames)
    result["filename"] = str(payload.get("filename", ""))[:255]
    return jsonify(result)


@app.errorhandler(413)
def too_large(_e):
    return jsonify({"error": "Too much text to process at once."}), 413


@app.errorhandler(500)
def server_error(e):
    import traceback
    traceback.print_exc()
    return (
        f"<h3>500 Internal Server Error</h3>"
        f"<p>An unexpected error occurred while processing the request.</p>"
        f"<pre>{str(e)}</pre>",
        500,
    )


if __name__ == "__main__":
    # Debug mode is enabled by default for local development so tracebacks are clear.
    # Set FLASK_DEBUG=0 to disable.
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    port = int(os.environ.get("PORT", 5000))
    app.run(host="127.0.0.1", port=port, debug=debug, use_reloader=False)
