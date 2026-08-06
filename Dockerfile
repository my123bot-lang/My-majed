FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV CLOUD=1
ENV ADMIN_HOST=0.0.0.0
ENV ADMIN_PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||process.env.ADMIN_PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "cloud.js"]
