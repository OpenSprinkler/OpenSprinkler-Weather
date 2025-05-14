FROM node
ENV PERSISTENCE_LOCATION=/data
EXPOSE 3000

RUN groupadd osweather && useradd --no-log-init -m -g osweather osweather && \
    mkdir /data && \
    chown osweather:osweather /data

USER osweather
VOLUME /data

ADD --chown=osweather:osweather . weather

WORKDIR weather
RUN npm install
RUN npm run compile
CMD npm start

