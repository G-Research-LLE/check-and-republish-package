# check-and-republish-package

GitHub action which checks that a GitHub Artifact produced by a workflow in another repo came from one of a named list of trusted branches. If so, it uploads the contents of the Artifact as a GitHub Package.
The workflow in the other repository is expected to use [G-Research-LLE/request-republish-package](https://github.com/G-Research-LLE/request-republish-package).

## Why?

This action (combined with [G-Research-LLE/request-republish-package](https://github.com/G-Research-LLE/request-republish-package) and some carefully crafted permissions)
can be used to ensure that all of the GitHub packages on a GitHub org have been built from protected branches. This is useful where the packages are to be relied upon in a
secure environment. For further details see SDR-816 in G-Research internal JIRA.

## Example usage

See [action.yml](action.yml).

```yaml
- uses: G-Research-LLE/check-and-republish-package@v1
  with:
    source-owner: G-Research-LLE
    source-repo: example-dotnet-core-classlib
    permitted-branches: master
    package-push-token: ${{secrets.PACKAGE_PUSH_TOKEN}}
```

## License

TBC.
