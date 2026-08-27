# Novel Studio — local AI web-novel chapter generator
# Runs as a tiny container (stdlib-only server). Data (worldbook/characters/plot/
# chapters/config.json with the API key) is mounted at /app/data so it persists
# on the host and never lives inside the image.
FROM python:3.11-slim

WORKDIR /app
COPY server.py .
COPY public ./public

ENV NOVEL_STUDIO_PORT=8787
EXPOSE 8787

# Optional: set NOVEL_STUDIO_TOKEN at runtime to require an admin token.
CMD ["python", "server.py"]
