FROM docker.io/library/node:20-alpine AS build
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
RUN npm run build

FROM docker.io/library/nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# SPA fallback: serve index.html for all non-asset routes
RUN printf 'server {\n  listen 3006;\n  root /usr/share/nginx/html;\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 3006
CMD ["nginx", "-g", "daemon off;"]
