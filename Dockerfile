# Range-safety dashboard service image.
#
# The dashboard reads the omd analysis DB + plan store + the study store
# read-only and renders the case table, state strip, and per-run detail
# (provenance DAG, results, plots, N2). It runs as its own service in
# deployments -- the tool images do not bundle hangar-range-safety.
#
# Build context is the the-hangar repo root (this package is a submodule
# there at packages/range-safety, and the image bundles its sibling
# packages). Mirrors packages/omd/Dockerfile so plot rendering matches omd
# exactly (same recorder-based plotting + openaerostruct for OAS plots).

# ---------------------------------------------------------------------------
# Frontend stage: build the React SPA (the dashboard's primary UI). The Vite
# build writes hashed assets into the Python package's static/spa dir; that
# output is copied into the runtime image below. Source checkouts without this
# build fall back to the legacy server-rendered htmx shell (app.py:spa_index).
# ---------------------------------------------------------------------------
FROM node:22-slim AS frontend
WORKDIR /pkg/frontend
COPY packages/range-safety/frontend/package.json packages/range-safety/frontend/package-lock.json ./
RUN npm ci
COPY packages/range-safety/frontend/ ./
RUN npm run build
# build output -> /pkg/src/hangar/range_safety/dashboard/static/spa (vite outDir)

FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        gfortran \
        git \
        libopenblas-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# OpenAeroStruct (pinned, tracks scripts/upstream-pins.env OAS_REF) so the
# dashboard can render OAS run plots identically to omd.
ARG OAS_REF=0a4d614f9494cbadaba4a6fa32a33d6e54e14f34
RUN pip install --no-cache-dir "openaerostruct @ git+https://github.com/mdolab/OpenAeroStruct.git@${OAS_REF}"

# SDK first (changes least often -> better layer caching)
COPY packages/sdk/ packages/sdk/
RUN pip install --no-cache-dir "packages/sdk[all]"

# results-reader (read seam for the analysis DB)
COPY packages/results-reader/ packages/results-reader/
RUN pip install --no-cache-dir packages/results-reader

# omd (the dashboard's OmdSource reads omd plans/provenance and renders
# plots via hangar.omd.plotting). openaerostruct dep already satisfied.
COPY packages/omd/ packages/omd/
RUN pip install --no-cache-dir --no-deps packages/omd && \
    pip install --no-cache-dir click jsonschema pyyaml matplotlib "openmdao>=3.35,!=3.40"

# The dashboard itself + its web-server runtime deps. itsdangerous backs
# Starlette's SessionMiddleware (OIDC session cookie); uvicorn serves it.
COPY packages/range-safety/ packages/range-safety/
# Built SPA from the frontend stage (overlays the gitignored static/spa dir).
COPY --from=frontend /pkg/src/hangar/range_safety/dashboard/static/spa \
    packages/range-safety/src/hangar/range_safety/dashboard/static/spa
RUN pip install --no-cache-dir --no-deps packages/range-safety && \
    pip install --no-cache-dir "starlette>=0.37" "jinja2>=3.1" itsdangerous "uvicorn[standard]"

RUN useradd -r -m -s /usr/sbin/nologin dashboard && \
    mkdir -p /data /scratch && chown dashboard:dashboard /data /scratch

# omd run data + study store are bind-mounted read-only at /data; the read
# paths are pinned there explicitly. Plot rendering writes PNGs under
# omd_data_root()/plots, so OMD_DATA_ROOT points at a writable scratch dir
# (the container's own layer) -- never the read-only mount.
ENV HANGAR_DATA_DIR=/data
ENV OMD_DB_PATH=/data/analysis.db
ENV OMD_PLAN_STORE=/data/plans
ENV OMD_RECORDINGS_DIR=/data/recordings
ENV OMD_DATA_ROOT=/scratch
ENV MPLCONFIGDIR=/tmp/matplotlib

EXPOSE 7655

USER dashboard

CMD ["uvicorn", "hangar.range_safety.dashboard.app:app", \
     "--host", "0.0.0.0", "--port", "7655"]
