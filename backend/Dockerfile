FROM python:3.12-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    g++ \
    curl \
    gnupg \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

# Coral Edge TPU runtime — needed by pycoral to talk to /dev/apex_* devices.
# Skips silently if packages.cloud.google.com is unreachable at build time.
RUN curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
        | gpg --dearmor -o /usr/share/keyrings/coral-edgetpu-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/coral-edgetpu-keyring.gpg] \
        https://packages.cloud.google.com/apt coral-edgetpu-stable main" \
        > /etc/apt/sources.list.d/coral-edgetpu.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends libedgetpu1-std \
    && rm -rf /var/lib/apt/lists/* \
    || (echo "WARNING: Coral Edge TPU runtime unavailable — skipping" \
        && rm -rf /var/lib/apt/lists/*)

WORKDIR /app

COPY pyproject.toml .
RUN python -c "import tomllib; print('\n'.join(tomllib.load(open('pyproject.toml','rb'))['project']['dependencies']))" > /tmp/requirements.txt \
    && pip install --no-cache-dir -r /tmp/requirements.txt

COPY . .
RUN pip install --no-cache-dir --no-deps .

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]

# ── Dev target (used by docker-compose.dev.yml) ──────────────────────────────
FROM base AS dev
RUN pip install --no-cache-dir pytest pytest-asyncio ruff httpx
