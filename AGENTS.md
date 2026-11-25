# Releases

When preparing a public release or a user-requested preview version, use `npm version patch --no-git-tag-version` for fixes and small refinements, `npm version minor --no-git-tag-version` for new features, and `npm version major --no-git-tag-version` for major redesigns or incompatible releases. The npm version hook reads `package.json` and updates the header in `Vmajor.minor.patch` format. Commit the header, package manifest, and lockfile together with the release.
