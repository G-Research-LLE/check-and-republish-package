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
