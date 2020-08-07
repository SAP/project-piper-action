#!/bin/sh

. build.sh
wget --timestamping https://dl.google.com/go/go1.14.2.linux-amd64.tar.gz
docker build . -f DevEnv.Dockerfile -t project-piper-action
docker run -e RUNNER_TEMP=/tmp -it --rm project-piper-action bash
