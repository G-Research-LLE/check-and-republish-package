# check-and-republish-package


# check-and-republish-package

This action checks that a package associated with a different repo to the one with the workflow that's running the action has been built from
master, and republishes the package associaed with this repo if so.

## Inputs

### `who-to-greet`

**Required** The name of the person to greet. Default `"World"`.

## Outputs

### `time`

The time we greeted you.

## Example usage

uses: actions/hello-world-javascript-action@v1
with:
  who-to-greet: 'Mona the Octocat'

## Testing locally

Install act:

curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash

Update example_event.json for the case you want to test (be careful not to check in a currently-valid GitHub PAT).

act --eventpath example_event.json

### To move docker location and run with more complete image

sudo systemctl stop docker
sudo mv /var/lib/docker /ephemeral/docker
sudo ln -s /ephemeral/docker /var/lib/
sudo systemctl start docker

act --eventpath example_event.json -P ubuntu-latest=nektos/act-environments-ubuntu:18.04

(Wait while it download an 18 GB docker image - that's why you moved the docker location to ephemeral)
