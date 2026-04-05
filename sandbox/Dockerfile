FROM docker.io/library/node:20-alpine
RUN apk add --no-cache podman fuse-overlayfs
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY dist ./dist
CMD ["node", "dist/index.js"]
