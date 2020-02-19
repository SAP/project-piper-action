# Project "Piper" GitHub Action

Continuous delivery is a method to develop software with short feedback cycles.
It is applicable to projects both for SAP Cloud Platform and SAP on-premise platforms.
SAP implements tooling for continuous delivery in [project "Piper"](https://sap.github.io/jenkins-library/).

This repository contains a GitHub Action to integrate with project "Piper".

## Usage

Please refer to the [GitHub Actions](https://help.github.com/en/actions) documentation for general information on how to use actions.

As an example, if your projects uses [Karma](https://karma-runner.github.io/latest/index.html) you can run it like this:

```yaml
on: push
name: Test
jobs:
  build:
    runs-on: ubuntu-18.04
    steps:
    - uses: actions/checkout@v1
    - uses: SAP/project-piper-action@master
      with:
        command: karmaExecuteTests
```

The key `command` needs to be replaced with the command you want to use.
The `help` command shows which commands are available.

Optionally you may use `flags` to provide command line arguments.

## Configuration

Configuration is done in `.pipeline/config.yml` in your project's repository.
See [here](https://sap.github.io/jenkins-library/configuration/) for information on configuration.

Based on the Karma example above, you might need to configure it differently based on how your project is set up.
An example might be:

```yaml
steps:
  karmaExecuteTests:
    installCommand: npm install --quiet --no-audit
    runCommand: npm test
```

## Development Setup

First, install the dependencies and build the distributable:

```bash
npm install
npm run package
```

You'll get a distributable file in `dest`.
Make sure the distributable is up-to-date before you push.

To try it out locally, you may use Docker:

```
docker build . -f DevEnv.Dockerfile -t project-piper-action
docker run -it --rm project-piper-action bash
$ node index.js
```

For convinience those steps are wrapped into `startDevEnv.sh`.

To provide _inputs_, you may set environment variables with the right names as in this example:

```
INPUT_COMMAND=version INPUT_FLAGS='-v' node index.js
```

## Limitations

This software runs on [GitHub Actions](https://github.com/features/actions) with Linux hosts.

## Known Issues

No known issues as of now.

# How to obtain support

Feel free to open new issues for feature requests, bugs or general feedback on
the [GitHub issues page of this project](https://github.com/sap/project-piper-action/issues).

## License

Copyright (c) 2020 SAP SE or an SAP affiliate company. All rights reserved.
This file is licensed under the Apache Software License, v. 2 except as noted
otherwise in the [LICENSE file](./LICENSE)
