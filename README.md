# Project "Piper" GitHub Action

Continuous delivery is a method to develop software with short feedback cycles.
It is applicable to projects both for SAP Cloud Platform and SAP on-premise platforms.
SAP implements tooling for continuous delivery in [project "Piper"](https://sap.github.io/jenkins-library/).
This repository contains a GitHub Action to integrate with project "Piper".

## Requirements

This software runs on [GitHub Actions](https://github.com/features/actions) with Linux hosts.

## Download and Installation

```bash
npm install
npm run package
```

```yaml
uses: sap/project-piper-action@v1
with:
  command: help
```

## Configuration

See [here](https://sap.github.io/jenkins-library/configuration/) for information on configuration.

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
