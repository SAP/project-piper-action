# Project "Piper" GitHub Action

Continuous delivery is a method to develop software with short feedback cycles.
It is applicable to projects both for SAP Cloud Platform and SAP on-premise platforms.
SAP implements tooling for continuous delivery in [project "Piper"](https://sap.github.io/jenkins-library/).

This repository contains a GitHub Action to integrate with project "Piper".

## Requirements

This software runs on [GitHub Actions](https://github.com/features/actions) with Linux hosts.

## Usage

Please refer to the [GitHub Actions](https://help.github.com/en/actions) documentation for general information on how to use actions.

To include Project "Piper" GitHub Action in your workflow, use this snippet:

```yaml
uses: sap/project-piper-action@master
with:
  command: help
```

The key `command` needs to be replaced with the command you want to use.
The `help` command shows which commands are available.

## Configuration

Configuration is done in `.pipeline/config.yml` in your project's repository.
See [here](https://sap.github.io/jenkins-library/configuration/) for information on configuration.

## Download and Installation for Development

First, install the dependencies and build the distributable:

```bash
npm install
npm run package
```

You'll get a distributable file in `dest`.

To try it out locally, you may use Docker:

```
docker build . -f DevEnv.Dockerfile -t project-piper-action
docker run -it --rm project-piper-action bash
$ node index.js
```

## Limitations

This software runs on [GitHub Actions](https://github.com/features/actions) with Linux hosts.

## Known Issues

No known issues as of now.

## How to obtain support

Please open an [issue on GitHub](https://github.com/sap/project-piper-action/issues).

## License

Copyright (c) 2020 SAP SE or an SAP affiliate company. All rights reserved.
This file is licensed under the Apache Software License, v. 2 except as noted
otherwise in the [LICENSE file](./LICENSE)
