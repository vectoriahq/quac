# Working in this repository

QUAC is a STAC profile and its two implementations: `packages/quac/` (the JavaScript package, with the spec in `packages/quac/spec/`) and `packages/quac-qgis-server/` (the QGIS Server plugin and its Python port of the JavaScript reader). The README says what each holds.

## Writing in this repository

- **Describe the change, not the conversation.** Code comments, notes, commit messages and pull request bodies say what the code does and what the spec says. They don't name private individuals, quote discussions, or point at documents outside this repository.
- **No links to agent sessions** in commits or pull requests. The GitHub tool that opens a pull request adds one to its description's footer, so read the description back once it is open and remove the link.
- **No real data.** Test projects and examples use made-up data and `example.test` addresses, never a real person's name, a real organisation's data or a path from someone's computer.

## Checks

```bash
npm ci
npm test
npm run typecheck
npm run test:server
```

The first runs the JavaScript tests, the second checks the JavaScript's types, and the third runs the plugin's Python tests. The QGIS Server workflow, `.github/workflows/qgis-server.yml`, runs the plugin inside QGIS Server; it cannot run in an agent's container, so push and read its run.

## Releasing

`RELEASING.md` says how the JavaScript package, the QGIS plugin, and the schema and site are published.

When a release needs a person to publish it, hand them a link to the new-release form with the tag, the target, the title and the notes filled in, and the same fields typed out: the tag, the target, the title (the tag, typed out), the notes to paste and the box to tick. `RELEASING.md` § "The title and the notes" says what goes in each and how the link fills them in.

## Keeping the two implementations in agreement

Each module under `packages/quac-qgis-server/quac_server/` mirrors the JavaScript module of the same name in `packages/quac/src/`. A change under `packages/quac/src/parse/` or `generate/` that moves a saved catalogue needs the same change in the Python, and `packages/quac-qgis-server/README.md` says how the tests keep them in agreement.

## Commit messages

`<type>(<scope>): <summary>`, then one to three plain bullets: the change, its effect, and the checks run.
