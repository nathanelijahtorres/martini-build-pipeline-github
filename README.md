# Martini upload package action

This action zips and uploads a Martini package to a Martini instance. For an example package and usage please refer to
the [sample repository](https://github.com/lontiplatform/martini-build-pipeline-github)

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
        uses: lontiplatform/martini-upload-package-action@main
        with:
          base_url: "http://localhost:8080"
          access_token: "myaccesstoken"
```

## Inputs

| Input           | Default      | Required | Description                                                                          |
|-----------------|--------------|----------|--------------------------------------------------------------------------------------|
| `base_url`      | N/A          | Yes      | Base URL of the Martini instance                                                     |
| `access_token`  | N/A          | Yes      | Access token of Martini which can be obtained from your instance or Lonti Console    |
| `package_dir`   | packages     | No       | Path to a directory that contains the package's files                                |

## Outputs

| Output    | Description                     |
|-----------|---------------------------------|
| `id`      | ID of the uploaded package      |
| `name`    | Name of the uploaded package    |
| `status`  | Status of the uploaded package  |
| `version` | Version of the uploaded package |
