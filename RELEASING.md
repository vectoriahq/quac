# Releasing

How each part of QUAC is published.

## The JavaScript package

1. Set the new version in `packages/quac/package.json` and merge it to `main`.
2. Publish a GitHub release from `main` whose tag is the package's name and that version, such as `@vectoriahq/quac@0.1.0`.

The [Publish to npm](.github/workflows/npm-publish.yml) workflow then checks the tag against the version, runs the types and tests, and publishes the package to npm.

### A test version

To try a change before it is released, publish a test version from its pull request's branch:

1. On the branch, set the version to a test version, such as `0.2.0-next.1`.
2. Publish a GitHub release from that branch, tagged `@vectoriahq/quac@0.2.0-next.1`, with **Set as a pre-release** ticked.

npm lists a test version under its `next` tag, so `npm install @vectoriahq/quac` still installs the last full release, and `npm install @vectoriahq/quac@0.2.0-next.1` installs the test version. Before the pull request merges, set the version to the release it will become.

## The QGIS plugin

1. Set the new version in `packages/quac-qgis-server/quac_catalogue/metadata.txt` and merge it to `main`.
2. Publish a GitHub release from `main` whose tag is the plugin's folder name and that version, such as `quac_catalogue@0.1.0`.
3. Download the zip the [Build the QGIS plugin](.github/workflows/plugin-release.yml) workflow attaches to the release, and upload it at [plugins.qgis.org](https://plugins.qgis.org/plugins/add/).

The workflow checks the tag against the version and runs the plugin's tests before it builds the zip.

## The schema and the site

The [Publish the schema and front page](.github/workflows/schema-pages.yml) workflow runs when a change to the schema, the site or the mark reaches `main`. It copies the schema to the `gh-pages` branch at the path its `$id` names, each version in a folder of its own, and writes the site's front page from [`site/`](site/), listing every version. GitHub Pages serves that branch at [`https://vectoriahq.github.io/quac/`](https://vectoriahq.github.io/quac/).
