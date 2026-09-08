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
    from crawl4ai.content_filter_strategy import PruningContentFilter, BM25ContentFilter
    from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator
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

def _link_ratio(line: str) -> float:
    """Fraction of the line occupied by markdown links/images (nav ≈ 1.0)."""
    if not line:
        return 1.0
    linked = sum(len(m.group(0)) for m in re.finditer(r"!?\[.*?\]\(.*?\)", line))
    return linked / max(1, len(line))


def trim_boilerplate(md: str) -> str:
    """Cut leading chrome: drop lines until the first heading or a long,
    mostly-prose paragraph. Menus are link-dense short lines — prose isn't."""
    lines = (md or "").splitlines()
    start = 0
    for i, line in enumerate(lines):
        s = line.strip()
        if not s or s.lower().startswith("[jump to content]"):
            start = i + 1
            continue
        if re.match(r"^#{1,4}\s+\S", s):
            start = i
            break
        if len(s) > 150 and _link_ratio(s) < 0.4:
            start = i
            break
        start = i + 1
    return "\n".join(lines[start:]).strip()


async def _crawl_pages(urls, max_chars: int, query: str = ""):
    if not HAVE_CRAWL4AI:
        return [{"url": u, "title": "", "markdown": "", "error": "crawl4ai not installed"} for u in urls]
    # Fresh crawler per batch: it binds to the running loop, and each
    # request runs on its own loop via _run — never share across loops.
    #
    # NOTE (crawl4ai 0.9): a custom markdown_generator empties
    # result.markdown, and result.markdown_v2 is None — so filtering runs
    # in two proven stages instead: the scraper emits pruned fit_html, and
    # DefaultMarkdownGenerator converts that HTML to markdown directly
    # (with BM25 for query-focused /search extraction).
    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        page_timeout=20000,
        excluded_tags=["nav", "header", "footer", "aside", "form", "script", "style"],
        remove_overlay_elements=True,
    )
    generator = DefaultMarkdownGenerator()
    bm25 = BM25ContentFilter(user_query=query, bm25_threshold=1.2) if query else None
    pages = []
    try:
        async with AsyncWebCrawler(config=BrowserConfig(headless=True, verbose=False)) as crawler:
            for url in urls:
                try:
                    result = await crawler.arun(url=url, config=run_config)
                    if not result or not result.success:
                        err = (result.error_message if result else "") or "extraction failed"
                        pages.append({"url": url, "title": "", "markdown": "", "error": err})
                        continue
                    pruned_html = (getattr(result, "fit_html", "") or "").strip()
                    source_html = pruned_html or (getattr(result, "cleaned_html", "") or "")
                    md = ""
                    if source_html:
                        try:
                            gen = generator.generate_markdown(
                                source_html,
                                **({"content_filter": bm25} if bm25 else {}),
                            )
                            md = (gen.fit_markdown or gen.raw_markdown or "").strip()
                        except Exception:
                            md = ""
                    if not md:
                        md = (result.markdown or "").strip()
                    # NOTE: DefaultMarkdownGenerator.fit_markdown already
                    # excludes boilerplate; trim the fallback raw path too.
                    text = trim_boilerplate(md)[:max_chars]
                    if not text.strip():
                        text = md[:max_chars]
                    if not text.strip():
                        pages.append({"url": url, "title": "", "markdown": "", "error": "empty page after filtering"})
                        continue
                    meta = result.metadata or {}
                    pages.append({"url": url, "title": meta.get("title", ""), "markdown": text})
                except Exception as exc:  # per-URL failure must not fail the batch
                    pages.append({"url": url, "title": "", "markdown": "", "error": str(exc)[:300]})
    except Exception as exc:
        return [{"url": u, "title": "", "markdown": "", "error": f"crawler start failed: {exc}"} for u in urls]
    return pages


AD_MARKERS = ("duckduckgo.com/y.js", "/aclick", "ad_domain=", "ad_provider=")


def _resolve_href(href: str):
    href = (href or "").strip()
    if not href:
        return None
    if any(m in href for m in AD_MARKERS):
        return None  # sponsored/tracking links are not sources
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
        if any(m in target for m in AD_MARKERS):
            return None  # unwrapped target is still a sponsored/tracking link
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
    # Snippets join by result URL (their anchors carry the same href) —
    # positional pairing mismatches because DDG interleaves extra nodes.
    snippets = {}
    for m in re.finditer(
        r'<a[^>]*class="result__snippet"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', html, re.DOTALL
    ):
        url = _resolve_href(m.group(1))
        text = _strip_tags(m.group(2))
        if url and text and url not in snippets:
            snippets[url] = text[:500]
    # Fallback for snippet anchors without href: positional fill for links
    # that found nothing by URL.
    if len(snippets) < len(links):
        loose = [
            _strip_tags(m.group(1))
            for m in re.finditer(r'<a[^>]*class="result__snippet"(?![^>]*href)[^>]*>(.*?)</a>', html, re.DOTALL)
        ]
        loose = [s for s in loose if s]
        li = 0
        for link in links:
            if link["url"] not in snippets and li < len(loose):
                snippets[link["url"]] = loose[li][:500]
                li += 1
    out = []
    for link in links:
        out.append({
            "url": link["url"],
            "title": link["title"],
            "snippet": snippets.get(link["url"], ""),
            "content": "",
        })
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
            # Crawl in order until max_pages non-empty results (bounded extra
            # fetches) — an empty JS-shell page must not eat a content slot.
            got = 0
            tried = 0
            for link in links:
                if got >= max_pages or tried >= max_pages + 2:
                    break
                tried += 1
                pages = _run(_crawl_pages([link["url"]], MAX_CHARS_DEFAULT, query))
                page = pages[0] if pages else {}
                if page.get("markdown", "").strip():
                    link["content"] = page["markdown"]
                    if not link["title"] and page.get("title"):
                        link["title"] = page["title"]
                    got += 1
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
