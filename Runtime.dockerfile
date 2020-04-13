# Dockerfile for running the Project "Piper" Action locally using https://github.com/nektos/act
# NOTE: This is a Proof of Concept, depending on what your GitHub Actions workflow does, the image will be not work.
# Extend the Dockerfile as you see fit and build your own image.
# Usage:
# Install act from https://github.com/nektos/act
# Build the image: `docker build -t myimage -f Runtime.dockerfile .`
# Run using: `act -P ubuntu-18.04=myimage`

ARG JVM_VERSION=11.0.6.0.1
ARG MAVEN_VERSION=3.6.3
ARG NODE_VERSION=v12.16.1

FROM debian:buster-slim as builder

ARG JVM_VERSION
ARG MAVEN_VERSION
ARG NODE_VERSION

ADD https://github.com/SAP/SapMachine/releases/download/sapmachine-${JVM_VERSION}/sapmachine-jdk-${JVM_VERSION}_linux-x64_bin.tar.gz /jdk.tgz
RUN tar xzf jdk.tgz -C /opt
ADD http://apache.lauf-forum.at/maven/maven-3/${MAVEN_VERSION}/binaries/apache-maven-${MAVEN_VERSION}-bin.tar.gz /maven.tgz
RUN tar xzf /maven.tgz -C /opt
ADD https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.gz /node.tgz
RUN tar xzf /node.tgz -C /opt

FROM debian:buster-slim

ARG JVM_VERSION
ARG MAVEN_VERSION
ARG NODE_VERSION

ENV PATH=/opt/apache-maven-$MAVEN_VERSION/bin:/opt/node-$NODE_VERSION-linux-x64/bin:/opt/sapmachine-jdk-$JVM_VERSION/bin:$PATH

RUN apt-get -y update; apt-get -y dist-upgrade; apt-get -y install wget curl
COPY --from=builder /opt /opt
RUN mkdir -p /home/actions && echo "actions:x:1000:1000:actions:/home/actions:/bin/bash" >> /etc/passwd
RUN chown -R actions /home/actions
RUN echo "PATH=/opt/apache-maven-$MAVEN_VERSION/bin:/opt/node-$NODE_VERSION-linux-x64/bin:/opt/sapmachine-jdk-$JVM_VERSION/bin:$PATH" >> /home/actions/.bashrc
WORKDIR /home/actions
