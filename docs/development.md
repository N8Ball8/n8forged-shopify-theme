# Development guide

## Initial setup

1. Clone the repository and enter its directory.
2. Run `npm ci` to install the pinned Shopify CLI.
3. Run `npm run shopify:login` and complete Shopify authentication in the
   browser. This is the only credential step; never paste or commit tokens.
4. Run `npm run theme:list` and verify the N8Forged themes are visible.

## Start work

```sh
git fetch origin upstream
git switch development
git pull --ff-only origin development
git switch -c feature/short-description
npm run theme:check
npm run theme:dev
```

Shopify CLI creates a development theme for the local preview. The command
prints preview and editor URLs. Stop the process with `Ctrl+C`; it never
publishes the theme.

## Finish work

1. Run `npm run theme:check`.
2. Review the preview on desktop and mobile when the change affects rendering.
3. Commit only the intended files with an imperative message.
4. Push the feature branch and open a pull request into `development`.
5. Merge only after the required GitHub check passes.

Do not use `shopify theme push --live`, `shopify theme publish`, or direct pushes
to protected branches during feature development.

## Theme-editor changes

The Shopify visual editor can change JSON configuration without changing local
files. Treat those edits as source drift. Reproduce or pull the edit into a
feature branch, review the diff carefully, and merge it through GitHub before it
becomes a permanent production change.
