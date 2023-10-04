FROM node:20-buster-slim

USER root
RUN mkdir /home/actions && echo "actions:x:1002:1002:actions:/home/actions:/bin/bash" >> /etc/passwd && chown -R actions /home/actions

# Setup dependencies for building development versions of piper
RUN apt-get -yqq update && apt-get -yqq install unzip ca-certificates


USER actions

ENV PATH="/opt/go/bin:${PATH}"

COPY dist/index.js /home/actions/index.js
WORKDIR /home/actions
