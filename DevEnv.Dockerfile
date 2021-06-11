FROM node:12-buster-slim

USER root
RUN mkdir /home/actions && echo "actions:x:1002:1002:actions:/home/actions:/bin/bash" >> /etc/passwd && chown -R actions /home/actions

# Setup dependencies for building development versions of piper
RUN apt-get -yqq update && apt-get -yqq install unzip ca-certificates
COPY go1.14.2.linux-amd64.tar.gz /tmp/go.tgz
RUN tar xzf /tmp/go.tgz -C /opt; rm /tmp/go.tgz

USER actions

ENV PATH="/opt/go/bin:${PATH}"
ENV RUNNER_TOOL_CACHE=/tmp RUNNER_TEMP=/tmp

COPY dist /home/actions
WORKDIR /home/actions
