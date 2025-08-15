FROM alpine:lts AS build_eto
WORKDIR /eto

RUN apk add --no-cache imagemagick gcc libc-dev build-base

COPY /baselineEtoData/dataPreparer.c ./dataPreparer.c
COPY /baselineEtoData/prepareData.sh ./prepareData.sh

RUN chmod +x ./prepareData.sh

RUN ash ./prepareData.sh 20

FROM node:lts-alpine AS build_node
WORKDIR /weather

COPY /tsconfig.json ./
COPY /package.json ./
COPY /package-lock.json ./
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
