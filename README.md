# Project "Piper" GitHub Action

[![REUSE status](https://api.reuse.software/badge/github.com/SAP/project-piper-action)](https://api.reuse.software/info/github.com/SAP/project-piper-action)

Continuous delivery is a method to develop software with short feedback cycles.
It is applicable to projects both for SAP Cloud Platform and SAP on-premise platforms.
SAP implements tooling for continuous delivery in [project "Piper"](https://sap.github.io/jenkins-library/).

This repository contains a GitHub Action to integrate with project "Piper".
It allows you to use project "Piper" in a convinient way with GitHub Actions.
You might also manually download the [cli](https://sap.github.io/jenkins-library/cli/) and use it in a shell script, if the action does not what you need.

## Usage

Please refer to the [GitHub Actions](https://help.github.com/en/actions) documentation for general information on how to use actions.

As an example, if your projects uses [Maven](https://maven.apache.org/index.html) you can run it like this:

```yaml
name: CI
on:
  push:
jobs:
  build:
    runs-on: ubuntu-18.04
    steps:
      - uses: actions/checkout@v1
      - name: mavenBuild
        uses: SAP/project-piper-action@master
        with:
          command: mavenBuild
      - name: mavenExecuteStaticCodeChecks
        uses: SAP/project-piper-action@master
        with:
          command: mavenExecuteStaticCodeChecks
```

The key `command` needs to be replaced with the command you want to use.
The `help` command shows which commands are available.

Optionally you may use `flags` to provide command line arguments.

## Configuration

Configuration is done in `.pipeline/config.yml` in your project's repository.
See [here](https://sap.github.io/jenkins-library/configuration/) for information on configuration.

For example, if you use [Karma](https://karma-runner.github.io/latest/index.html), you might need to configure it differently based on how your project is set up.
An example might be:

```yaml
steps:
  karmaExecuteTests:
    installCommand: npm install --quiet --no-audit
    runCommand: npm test
```

## Development Setup

First, add the Github npm repository for the @sap scope by making sure that your `~/.npmrc` contains the following line

```
@sap:registry=https://npm.pkg.github.com
```

Then install the dependencies and build the distributable:

```bash
npm install
npm run prepare
```

You'll get a distributable file in `dest`.
Make sure the distributable is up-to-date before you push.

To try it out locally, you may use Docker:

```bash
docker build . -f DevEnv.Dockerfile -t project-piper-action
docker run -it --rm project-piper-action bash
$ node index.js
```

For convinience those steps are wrapped into `startDevEnv.sh`.

To provide _inputs_, you may set environment variables with the right names as in this example:

```bash
INPUT_COMMAND=version INPUT_FLAGS='-v' node index.js
```

## Limitations

This software runs on [GitHub Actions](https://github.com/features/actions) with Linux hosts.

## Known Issues

No known issues as of now.

## How to obtain support

Feel free to open new issues for feature requests, bugs or general feedback on
the [GitHub issues page of this project](https://github.com/sap/project-piper-action/issues).
