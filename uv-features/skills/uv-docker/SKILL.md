---
name: uv-docker
description: |
  This skill should be used when the user asks to "use uv in Docker",
  "write a Dockerfile with uv", "uv sync in Docker", "uv multi-stage build",
  or when writing a Dockerfile that uses uv for Python dependency installation.
  Guides uv-based multi-stage container builds.
---

# Python Docker Images with uv

Use multi-stage builds with uv. The final image should NOT contain uv — only the installed venv.

## Multi-Stage Build

```dockerfile
# Stage 1: Build
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_DEV=1 UV_PYTHON_DOWNLOADS=0
WORKDIR /app

# Install dependencies first (cached layer)
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project

# Copy source and install project
COPY . /app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked

# Stage 2: Runtime (no uv, no build tools)
# IMPORTANT: Use the same Python version as the builder
FROM python:3.12-slim-bookworm

RUN groupadd --system --gid=999 nonroot \
 && useradd --system --gid=999 --uid=999 --create-home nonroot

COPY --from=builder --chown=nonroot:nonroot /app /app
ENV PATH="/app/.venv/bin:$PATH"
USER nonroot
WORKDIR /app
CMD ["python", "main.py"]
```

Key points:
- Final image has no uv, no cache, no build tools
- Runtime image must use the same Python version as the builder
- `UV_COMPILE_BYTECODE=1` — pre-compile .pyc for faster startup
- `UV_LINK_MODE=copy` — required when cache mount is on a different filesystem
- `UV_PYTHON_DOWNLOADS=0` — use system Python, no managed downloads
- `UV_NO_DEV=1` — omit development dependencies
- `--locked` — ensure lockfile is up-to-date, fail otherwise
- Run as non-root user in production

## .dockerignore

```
.venv
__pycache__
```

## Reference

If more detail is needed, consult:
- https://docs.astral.sh/uv/guides/integration/docker/
- https://github.com/astral-sh/uv-docker-example/blob/main/multistage.Dockerfile
