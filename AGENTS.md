# Releases

When publishing user-facing changes, run `npm version patch --no-git-tag-version` for fixes and small refinements or `npm version minor --no-git-tag-version` for new features while the app is in `0.x`. The npm version hook updates the header from `package.json`. Commit the header, package manifest, and lockfile together with the release.
