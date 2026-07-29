FROM node:24-bookworm-slim AS build

WORKDIR /weather

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run compile


FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /weather

COPY package*.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY --from=build /weather/js ./js
COPY --from=build /weather/baselineEToData ./baselineEToData
COPY --from=build /weather/public/dashboard/*.html ./public/dashboard/
COPY --from=build /weather/public/dashboard/*.css ./public/dashboard/
COPY --from=build /weather/public/dashboard/*.js ./public/dashboard/
COPY --from=build /weather/docs ./docs
COPY --from=build /weather/README.md ./README.md

RUN mkdir -p /weather/baselineEToData \
    && touch /weather/geocoderCache.json /weather/observations.json \
    && chown -R node:node /weather

USER node

EXPOSE 3000

CMD ["npm", "start"]
