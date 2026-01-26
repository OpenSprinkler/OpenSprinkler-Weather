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

FROM node:lts-alpine AS build_node
WORKDIR /weather

COPY /tsconfig.json ./
COPY /package.json ./
RUN npm install
COPY /build.mjs ./

COPY /src ./src
RUN npm run build

FROM node:lts-alpine

EXPOSE 3000
EXPOSE 8080

WORKDIR /weather
COPY /package.json ./
RUN mkdir baselineEToData

# Create data directory for persistent storage (PR #144)
RUN mkdir -p /data

COPY --from=build_eto /eto/Baseline_ETo_Data.bin ./baselineEToData
COPY --from=build_node /weather/dist ./dist

# Set persistence location for observations.json and geocoderCache.json (PR #144)
ENV PERSISTENCE_LOCATION=/data

# Declare volume for persistent data
VOLUME /data

CMD ["npm", "run", "start"]