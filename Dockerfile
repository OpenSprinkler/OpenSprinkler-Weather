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
COPY --from=build_eto /eto/Baseline_ETo_Data.bin ./baselineEToData
COPY --from=build_node /weather/dist ./dist

CMD ["npm", "run", "start"]
