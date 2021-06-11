#!/bin/sh

npm install
npm run package
docker build . -f DevEnv.Dockerfile -t project-piper-action
docker run -it --rm project-piper-action bash
