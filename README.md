# Martini Build Github Actions

This action zips and uploads a Martini package to a Martini instance. For an example package and usage please refer to
the [sample repository](https://github.com/lontiplatform/martini-build-package)

## Usage

Here's an example of how to use this action in a workflow file:

```yaml
name: Example Workflow

on: [push]

jobs:
  upload_package:
    name: Upload package
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
      - name: Upload the package
        uses: lontiplatform/martini-build-pipeline-github@v2
        with:
          base_url: "http://localhost:8080"
          access_token: "myaccesstoken"
```

## Inputs

| Variable                  | Required | Usage                                                                                                                  |
|---------------------------|----------|------------------------------------------------------------------------------------------------------------------------|
| base_url                  | Yes      | Base URL of the Martini instance                                                                                       |
| access_token              | Yes      | The user's access token, obtainable via Martini or through the Lonti Console                                           |
| package_dir               | No       | Root directory containing packages (defaults to `packages` if not specified)                                           |
| package_name_pattern      | No       | Regex pattern to filter which package directories to include. Defaults to `.*` (all directories).                      |
| async_upload              | No       | If set to `true`, tolerates HTTP 504 as a success (used when uploads are handled asynchronously). Defaults to `false`. |
| success_check_timeout     | No       | Number of polling attempts before timing out when checking package deployment status. Defaults to `6`.                 |
| success_check_delay       | No       | Number of seconds between polling attempts. Defaults to `30`.                                                          |
| success_check_package_name| No       | If set, only this specific package is polled after upload. If unset, all matched packages are polled.                  |

## Outputs

| Output    | Description                     |
|-----------|---------------------------------|
| `id`      | ID of the uploaded package      |
| `name`    | Name of the uploaded package    |
| `status`  | Status of the uploaded package  |
| `version` | Version of the uploaded package |
