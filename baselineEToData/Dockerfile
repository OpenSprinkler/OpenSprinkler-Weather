FROM alpine:3.10

VOLUME /output/
ENTRYPOINT ["/entrypoint.sh"]
# Default to 20 passes.
CMD ["20"]

COPY dataPreparer.c /dataPreparer.c
COPY prepareData.sh /prepareData.sh
COPY entrypoint.sh /entrypoint.sh

RUN apk --update add imagemagick gcc libc-dev && chmod +x /entrypoint.sh /prepareData.sh
