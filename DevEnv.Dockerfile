FROM node:12-buster-slim

ENV RUNNER_TOOL_CACHE=/tmp RUNNER_TEMP=/tmp
WORKDIR /home/actions
RUN apt-get -yqq update && apt-get -yqq install unzip ca-certificates
RUN echo "actions:x:1002:1002:actions:/home/actions:/bin/bash" >> /etc/passwd && chown -R actions /home/actions
USER actions
COPY dist /home/actions

CMD ["node", "./index.js"]
