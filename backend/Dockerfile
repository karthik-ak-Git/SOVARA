# SOVARA backend — multi-stage, non-root, healthchecked.
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app

FROM base AS builder
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --prefix=/install .

FROM base AS runtime
RUN groupadd -r sovara --gid 10001 && useradd -r -g sovara --uid 10001 sovara
COPY --from=builder /install /usr/local
COPY src ./src
ENV PYTHONPATH=/app/src
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health')"
CMD ["uvicorn", "sovara.main:app", "--host", "0.0.0.0", "--port", "8000"]
