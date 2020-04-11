FROM node:12-buster-slim

USER root
RUN mkdir /home/actions && echo "actions:x:1002:1002:actions:/home/actions:/bin/bash" >> /etc/passwd && chown -R actions /home/actions


# Download go for building devel versions of piper
COPY go.tgz /tmp/go.tgz
RUN tar xzf /tmp/go.tgz -C /opt; rm /tmp/go.tgz

USER actions

ENV PATH="/opt/go/bin:${PATH}"

COPY dist/index.js /home/actions/index.js
WORKDIR /home/actions
