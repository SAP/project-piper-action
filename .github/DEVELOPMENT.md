# Developer's documentation

This page is only relevant for you if you're working on project "piper" itself.

To build a development version of piper from source, use:

```yaml
env "INPUT_PIPER-VERSION=devel:SAP:jenkins-library:mycommitorbranch"
```

Concrete example:

```yaml
env "INPUT_PIPER-VERSION=devel:SAP:jenkins-library:b0144614e529018f661152769b5543243e6bf033" INPUT_COMMAND=version INPUT_FLAGS='-v' node index.js
```

## Development Setup

❗This part needs to be updated, it might not work exactly as described

First, install the dependencies and build the distributable:

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
INPUT_STEP_NAME=version INPUT_FLAGS='-v' node index.js
```
