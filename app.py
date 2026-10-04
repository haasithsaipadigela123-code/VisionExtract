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

from flask import Flask, request, jsonify, render_template

import extractor

app = Flask(__name__)
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


if __name__ == "__main__":
    # Debug mode (friendly error pages) is opt-in via an env var so a demo/
    # presentation never runs with a debug traceback on screen by accident.
    # The auto-reloader stays OFF either way (the .venv lives in this synced folder).
    debug = os.environ.get("FLASK_DEBUG") == "1"
    app.run(host="127.0.0.1", port=5000, debug=debug, use_reloader=False)
