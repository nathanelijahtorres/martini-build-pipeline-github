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
        uses: actions/martini-upload-package-action@main
        with:
          base_url: "http://localhost:8080"
          user_name: "myuser"
          user_password: "mycomplexpassword"
          package_dir: "packages/sample-package"
```

## Inputs

| Input       | Default | Description                                                                          |
|-------------|---------|--------------------------------------------------------------------------------------|
| `base_url`  | N/A     | Base URL of the Martini instance                                                     |
| `user_name` | N/A     | Name of a user on the Martini instance that should be used for uploading the package |
| `base_url`  | N/A     | The user's password                                                                  |
| `base_url`  | N/A     | Path to a directory that contains the package's files                                |

## Outputs

| Output    | Description                     |
|-----------|---------------------------------|
| `id`      | ID of the uploaded package      |
| `name`    | Name of the uploaded package    |
| `status`  | Status of the uploaded package  |
| `version` | Version of the uploaded package |