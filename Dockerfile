# 8gency, one image for the web app and for running migrations.
# ponytail: not slimmed to Next's standalone output because the migration and
# invite scripts need tsx and the dev dependencies. Slim it once deploys are routine.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app .
RUN useradd --create-home app && mkdir -p /app/uploads && chown -R app /app/uploads /app/.next
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Run migrations as a release step first: docker run --rm <image> npm run db:migrate
CMD ["npm", "start"]
