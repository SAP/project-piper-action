# Developer's documentation

This page is only relevant for you if you're working on project "piper" itself.

To use build a development version of piper from source, use:

```
env "INPUT_PIPER-VERSION=devel:SAP:jenkins-library:mycommitorbranch" INPUT_COMMAND=version INPUT_FLAGS='-v' node index.js
```

Concrete example:

```
env "INPUT_PIPER-VERSION=devel:SAP:jenkins-library:b0144614e529018f661152769b5543243e6bf033" INPUT_COMMAND=version INPUT_FLAGS='-v' node index.js
```
