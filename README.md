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

| Input              | Default     | Required | Description                                                                                                                                               |
|--------------------|-------------|----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `base_url`         | N/A         | Yes      | The base URL of your Martini instance.                                                                                                                    |
| `access_token`     | N/A         | Yes      | The access token for your Martini instance. You can obtain this from the instance directly or via the Lonti Console.                                      |
| `package_dir`      | `packages`  | No       | The path to the directory containing package folders.                                                                                                     |
| `allowed_packages` | N/A         | No       | A comma-separated list of specific package names to upload (e.g., `package2, package3`). If not provided, all packages in the directory will be uploaded. |

## Outputs

| Output    | Description                     |
|-----------|---------------------------------|
| `id`      | ID of the uploaded package      |
| `name`    | Name of the uploaded package    |
| `status`  | Status of the uploaded package  |
| `version` | Version of the uploaded package |
