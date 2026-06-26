FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY video-renderer/package.json ./
RUN npm install --omit=dev

COPY video-renderer/server.js ./
COPY assets/audio ./audio

ENV PORT=8080
CMD ["npm", "start"]
