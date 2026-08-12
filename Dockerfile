FROM alpine:latest AS build_eto
WORKDIR /eto

RUN apk add --no-cache tiff imagemagick gcc libc-dev build-base

COPY /baselineEToData/dataPreparer.c ./
COPY /baselineEToData/prepareData.sh ./
COPY /baselineEToData/baseline.sh ./

RUN chmod +x ./prepareData.sh ./baseline.sh

RUN ash ./prepareData.sh 20
RUN ash ./baseline.sh
RUN rm Baseline_ETo_Data-Pass_*.bin

FROM node:24-alpine AS build_node
WORKDIR /weather

COPY /tsconfig.json ./
COPY /package.json /package-lock.json ./
RUN npm ci
COPY /build.mjs ./

COPY /src ./src
RUN npm run build

FROM node:24-alpine

EXPOSE 3000

WORKDIR /weather
ENV HOST=0.0.0.0
ENV PERSISTENCE_LOCATION=/data
ENV GEOCODER_CACHE_FILE=/data/geocoderCache.json
RUN mkdir -p /data
VOLUME ["/data"]
RUN mkdir baselineEToData
COPY --from=build_eto /eto/Baseline_ETo_Data.bin ./baselineEToData
COPY --from=build_node /weather/dist ./dist

CMD ["node", "dist/index.cjs"]
