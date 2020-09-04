#!/bin/sh

npm install
npm run package
wget --timestamping https://dl.google.com/go/go1.14.2.linux-amd64.tar.gz
docker build . -f DevEnv.Dockerfile -t project-piper-action
docker run -it --rm project-piper-action bash
