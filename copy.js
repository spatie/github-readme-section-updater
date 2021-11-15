const workflowCode = Buffer.from(
    `name: "Update Changelog"

on:
  release:
    types: [released]

jobs:
  update:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v2
        with:
          ref: main

      - name: Update Changelog
        uses: stefanzweifel/changelog-updater-action@v1
        with:
          latest-version: \${{ github.event.release.name }}
          release-notes: \${{ github.event.release.body }}

      - name: Commit updated CHANGELOG
        uses: stefanzweifel/git-auto-commit-action@v4
        with:
          branch: main
          commit_message: Update CHANGELOG
          file_pattern: CHANGELOG.md
`
).toString('base64');

module.exports = { workflowCode };
