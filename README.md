# Piper GitHub Action

[![CI](https://github.com/SAP/project-piper-action/actions/workflows/ci.yaml/badge.svg)](https://github.com/SAP/project-piper-action/actions/workflows/ci.yaml)
[![REUSE Compliance Check](https://github.com/SAP/project-piper-action/actions/workflows/reuse.yaml/badge.svg)](https://github.com/SAP/project-piper-action/actions/workflows/reuse.yaml)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-%23FE5196?logo=conventionalcommits&logoColor=white)](https://conventionalcommits.org)
[![Log4brains ADRs](https://pages.github.com/SAP/project-piper-action/badge.svg)](https://pages.github.com/SAP/project-piper-action)

This GitHub action allows running [Piper](https://www.project-piper.io/) on GitHub Actions.

## Usage

This action can be used in a GitHub Actions workflow file as follows:

```yaml
- uses: SAP/project-piper-action@main
# or if you want to pin specific version use @v1.0.0 instead of @main
  with:
    step-name: mavenBuild
    flags: '--publish --createBOM --logSuccessfulMavenTransfers'
```

Please refer to the [GitHub Actions documentation](https://help.github.com/en/actions) for more information.

### Parameters

The `step-name` parameter can be one of [Piper's internal or open source steps](https://www.project-piper.io/lib/). The respective Piper binary is selected automatically.

Other inputs are listed in the [action.yml](./action.yml) file.

### Step Configuration

Piper step configuration is either done via Piper's configuration file in your project's repository or via step parameters passed to the step via the action's `flags` parameter.

See [Piper's docs section about configuration](https://www.project-piper.io/configuration/) for more information.

### Custom Defaults

You can specify custom defaults configuration files using the `custom-defaults-paths` parameter in various ways:

* Using a single custom defaults file:

```yaml
with:
  custom-defaults-paths: 'path/to/custom-defaults.yml'
```

* Using multiple custom defaults files:

```yaml
with:
  custom-defaults-paths: "path/to/custom-defaults1.yml,path/to/custom-defaults2.yml"
```

* Using custom defaults files from other repositories:

```yaml
with:
  custom-defaults-paths: "orgName1/repo1/path/to/custom-defaults.yml@v1.0.0,orgName2/repo2/path/to/custom-defaults.yml@v2.0.0"
```

### Secrets

Piper can load secrets directly from Vault if Vault approle roleID and secretID are provided via environment variables.

```yaml
env:
  PIPER_vaultAppRoleID: ${{ secrets.PIPER_VAULTAPPROLEID }}
  PIPER_vaultAppRoleSecretID: ${{ secrets.PIPER_VAULTAPPROLESECRETID }}
```

See also [Piper's Vault documentation](https://www.project-piper.io/infrastructure/vault/).
