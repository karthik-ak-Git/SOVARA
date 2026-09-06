"""Mandatory app-attribution for provider HTTP requests.

Cf. DeepSeek reference `attributionHeaders`: every provider request carries
a static public product identity as `User-Agent`; omission must never
suppress attribution. Public facts only — no secrets, paths, prompts,
or user identifiers. Adapters merge PROVIDER_HEADERS into each httpx call
(health, discovery, inference) so identity cannot drift per adapter.
"""

from sovara.version import __version__

SOVARA_USER_AGENT = f"sovara/{__version__} (+https://github.com/karthik-ak-Git/SOVARA)"

PROVIDER_HEADERS = {"user-agent": SOVARA_USER_AGENT}
