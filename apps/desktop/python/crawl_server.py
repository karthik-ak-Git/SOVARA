"""Sovara web sidecar: search-result discovery + crawl4ai page extraction.

Endpoints (loopback only, Flask like whisper_server.py):
  GET  /health          -> {"ready": true, "crawl4ai": bool}
  POST /search          {query, max_pages=3} -> {sources: [{url, title, snippet, content}]}
  POST /crawl           {urls: [...], max_chars=6000} -> {pages: [{url, title, markdown}]}

Search flow: DuckDuckGo HTML for result links (keyless), then crawl4ai
extracts the top pages to markdown. If crawl4ai/the browser is missing,
/search still returns discovered links with snippets (content empty) and
/crawl reports per-URL errors — the desktop falls back gracefully.
"""

import asyncio
import json
import re
import sys
from html import unescape
from urllib.parse import quote_plus, unquote

try:
    from flask import Flask, jsonify, request
    from flask_cors import CORS
except ImportError:
    print("crawl_server needs flask + flask-cors: pip install -r requirements.txt", flush=True)
    sys.exit(1)

try:
    import requests
except ImportError:
    print("crawl_server needs requests: pip install -r requirements.txt", flush=True)
    sys.exit(1)

try:
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
    HAVE_CRAWL4AI = True
except ImportError:
    HAVE_CRAWL4AI = False

app = Flask(__name__)
CORS(app)

DDG_HTML = "https://html.duckduckgo.com/html/?q="
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
MAX_PAGES_DEFAULT = 3
MAX_CHARS_DEFAULT = 6000

async def _crawl_pages(urls, max_chars: int):
    if not HAVE_CRAWL4AI:
        return [{"url": u, "title": "", "markdown": "", "error": "crawl4ai not installed"} for u in urls]
    # Fresh crawler per batch: it binds to the running loop, and each
    # request runs on its own loop via _run — never share across loops.
    run_config = CrawlerRunConfig(cache_mode=CacheMode.BYPASS, page_timeout=20000)
    pages = []
    try:
        async with AsyncWebCrawler(config=BrowserConfig(headless=True, verbose=False)) as crawler:
            for url in urls:
                try:
                    result = await crawler.arun(url=url, config=run_config)
                    if result and result.success and result.markdown:
                        text = result.markdown[:max_chars]
                        pages.append({"url": url, "title": result.metadata.get("title", "") if result.metadata else "", "markdown": text})
                    else:
                        err = (result.error_message if result else "") or "extraction failed"
                        pages.append({"url": url, "title": "", "markdown": "", "error": err})
                except Exception as exc:  # per-URL failure must not fail the batch
                    pages.append({"url": url, "title": "", "markdown": "", "error": str(exc)[:300]})
    except Exception as exc:
        return [{"url": u, "title": "", "markdown": "", "error": f"crawler start failed: {exc}"} for u in urls]
    return pages


def _resolve_href(href: str):
    href = (href or "").strip()
    if not href:
        return None
    if href.startswith("/l/") or href.startswith("//duckduckgo.com/l/"):
        q = href.split("?", 1)[1] if "?" in href else ""
        params = dict(p.split("=", 1) for p in q.split("&") if "=" in p)
        target = params.get("uddg")
        if not target:
            return None
        try:
            target = unquote(target)
        except Exception:
            return None
        return target if target.startswith(("http://", "https://")) else None
    absolute = ("https:" + href) if href.startswith("//") else href
    return absolute if absolute.startswith(("http://", "https://")) else None


def discover_links(query: str, limit: int = 8):
    """Keyless result-link discovery via DuckDuckGo HTML. Returns [{url,title,snippet}]."""
    resp = requests.get(
        DDG_HTML + quote_plus(query),
        headers={"User-Agent": BROWSER_UA, "Accept": "text/html"},
        timeout=15,
    )
    resp.raise_for_status()
    html = resp.text
    links = []
    seen = set()
    for m in re.finditer(
        r'<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', html, re.DOTALL
    ):
        url = _resolve_href(m.group(1))
        if not url or url in seen:
            continue
        seen.add(url)
        links.append({"url": url, "title": _strip_tags(m.group(2))})
        if len(links) >= limit:
            break
    snippets = [
        _strip_tags(m.group(1))
        for m in re.finditer(r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>', html, re.DOTALL)
    ]
    snippets = [s for s in snippets if s]
    out = []
    for i, link in enumerate(links):
        item = {"url": link["url"], "title": link["title"], "snippet": "", "content": ""}
        if i < len(snippets):
            item["snippet"] = snippets[i][:500]
        out.append(item)
    return out


def _strip_tags(html: str) -> str:
    text = re.sub(r"<[^>]+>", "", html or "")
    return re.sub(r"\s+", " ", unescape(text)).strip()


def _run(coro):
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if loop and loop.is_running():
        # Flask dev server is sync; run the coroutine on a fresh loop in a thread.
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, coro).result()
    return asyncio.run(coro)


@app.get("/health")
def health():
    return jsonify({"ready": True, "crawl4ai": HAVE_CRAWL4AI})


@app.post("/search")
def search():
    data = request.get_json(force=True, silent=True) or {}
    query = str(data.get("query", "")).strip()
    if not query:
        return jsonify({"error": "query is required"}), 400
    try:
        max_pages = max(1, min(5, int(data.get("max_pages", MAX_PAGES_DEFAULT))))
    except (TypeError, ValueError):
        max_pages = MAX_PAGES_DEFAULT
    try:
        links = discover_links(query, limit=8)
    except Exception as exc:
        return jsonify({"error": f"discovery failed: {exc}"}), 502
    if HAVE_CRAWL4AI and links:
        try:
            pages = _run(_crawl_pages([l["url"] for l in links[:max_pages]], MAX_CHARS_DEFAULT))
            by_url = {p["url"]: p for p in pages}
            for link in links:
                page = by_url.get(link["url"])
                if page and page.get("markdown"):
                    link["content"] = page["markdown"]
                    if not link["title"] and page.get("title"):
                        link["title"] = page["title"]
        except Exception as exc:
            print(f"[crawl] page extraction failed: {exc}", flush=True)
    return jsonify({"sources": links, "crawled": HAVE_CRAWL4AI})


@app.post("/crawl")
def crawl():
    data = request.get_json(force=True, silent=True) or {}
    urls = data.get("urls", [])
    if not isinstance(urls, list) or not urls:
        return jsonify({"error": "urls (non-empty array) is required"}), 400
    urls = [str(u) for u in urls[:5] if str(u).startswith(("http://", "https://"))]
    if not urls:
        return jsonify({"error": "no valid http(s) urls"}), 400
    try:
        max_chars = max(500, min(20000, int(data.get("max_chars", MAX_CHARS_DEFAULT))))
    except (TypeError, ValueError):
        max_chars = MAX_CHARS_DEFAULT
    try:
        pages = _run(_crawl_pages(urls, max_chars))
    except Exception as exc:
        return jsonify({"error": f"crawl failed: {exc}"}), 500
    return jsonify({"pages": pages})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 51821
    print(f"[crawl] starting on 127.0.0.1:{port} (crawl4ai={'yes' if HAVE_CRAWL4AI else 'NO — pip install crawl4ai'})", flush=True)
    app.run(host="127.0.0.1", port=port, threaded=True)
