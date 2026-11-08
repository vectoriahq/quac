# Working in this repository

QUAC is a STAC profile and its two implementations: `packages/quac/` (the JavaScript package, with the spec in `packages/quac/spec/`) and `packages/quac-qgis-server/` (the QGIS Server plugin and its Python port of the JavaScript reader). The README says what each holds.

## This repository is public

- **A decision is Vectoria's.** In code, comments, notes, commit messages and pull request bodies, record a decision as Vectoria's, with no person's name and no reason taken from a conversation.
- **Plans and discussion stay out.** Write here only what the code does and what the spec says. Plans, reviews of options and the reasons behind them belong in Vectoria's own records, not in this repository.
- **No session links.** A commit or pull request carries no link to an agent session.
- **No real data.** Test projects and examples use made-up data and `example.test` addresses, never a real person's name, a real organisation's data or a path from someone's computer.

## Checks

```bash
npm ci
npm test
npm run typecheck
npm run test:server
```

The first runs the JavaScript tests, the second checks the JavaScript's types, and the third runs the plugin's Python tests. The QGIS Server workflow, `.github/workflows/qgis-server.yml`, runs the plugin inside QGIS Server; it cannot run in an agent's container, so push and read its run.

## Keeping the two implementations in agreement

Each module under `packages/quac-qgis-server/quac_server/` mirrors the JavaScript module of the same name in `packages/quac/src/`. A change under `packages/quac/src/parse/` or `generate/` that moves a saved catalogue needs the same change in the Python, and `packages/quac-qgis-server/README.md` says how the tests keep them in agreement.

## Commit messages

`<type>(<scope>): <summary>`, then one to three plain bullets: the change, its effect, and the checks run.
