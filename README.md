# Martini upload package action

This action zips and uploads a Martini package to a Martini instance. For an example package and usage please refer to
the [sample repository](https://github.com/torocloud/sample-martini-repository)

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
          client_id: "myclientid"
          client_secret: "myclientsecret"
          user_name: "myuser"
          user_password: "mycomplexpassword"
          package_dir: "packages/sample-package"
```

## Inputs

## Inputs

| Input           | Default      | Required | Description                                                                          |
|-----------------|--------------|----------|--------------------------------------------------------------------------------------|
| `base_url`      | N/A          | Yes      | Base URL of the Martini instance                                                     |
| `client_id`     | `TOROMartini`| No       | Client ID of the Martini instance. If omitted, defaults to `TOROMartini`             |
| `client_secret` | N/A          | No       | Client Secret of the Martini instance                                                 |
| `user_name`     | N/A          | Yes      | Name of a user on the Martini instance that should be used for uploading the package |
| `user_password` | N/A          | Yes      | The user's password                                                                  |
| `package_dir`   | N/A          | Yes      | Path to a directory that contains the package's files                                |

## Outputs

| Output    | Description                     |
|-----------|---------------------------------|
| `id`      | ID of the uploaded package      |
| `name`    | Name of the uploaded package    |
| `status`  | Status of the uploaded package  |
| `version` | Version of the uploaded package |