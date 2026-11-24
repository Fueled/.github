---
name: php-version-bump
description: "Use when raising the minimum PHP version a WordPress plugin or theme supports, extending the PHP version it is tested up to, or checking whether it works on a PHP range such as 8.2 to 8.5. Takes a path and the min/max versions, gathers evidence (PHPCompatibility 10, php -l on every version, Composer installs from the lock, the test suite on both ends of the range, a runtime check on the newest), then reports or applies the header, Composer, CI and code changes. Triggers: bump minimum PHP, raise Requires PHP, drop PHP 7.4, test up to PHP 8.5, PHP compatibility check."
argument-hint: "[path] [min] [max]"
---

# PHP version bump

Raise the PHP range a WordPress plugin or theme supports to `<min>`–`<max>`, with evidence that it runs on both ends.

**What the range means:**
- `<min>` is declared: the `Requires PHP` headers, `composer.json` `require.php`, and the main file's bootstrap guard.
- `<max>` is proven: the CI test matrix and the PHPCompatibility `testVersion`.

WordPress has no "tested up to PHP" header. Don't invent one, and don't touch the WordPress `Requires at least` or `Tested up to` values.

**Evidence and its blind spots.** Each layer catches what the others miss, so run all of them:

| Layer | Catches | Misses |
|---|---|---|
| PHPCompatibility 10 (`scripts/check.sh`) | Removed and deprecated functions, constants, syntax, `E_USER_ERROR`, implicit nullable params | Dynamic properties, `null` passed to internal functions, `setAccessible()`, anything decided at runtime |
| `php -l` on every version (`scripts/check.sh`) | Parse errors and compile-time deprecations, from the real engine | Runtime behaviour |
| Composer install from the lock on `<min>` and `<max>` (`scripts/check.sh`) | Locks that no longer install, such as a stale `platform-overrides` or packages that need a newer PHP | Whether the code works |
| Tests on `<min>` and `<max>`, runtime check on `<max>` ([runtime-checks.md](references/runtime-checks.md)) | Runtime deprecations in own and bundled code, behaviour changes | Code paths nothing exercises |

PHPCompatibility 9.x (the 9.3.5 that `phpcompatibility-wp` 2.x installs) has no sniffs for PHP 8.1 or later. A clean 9.x scan says nothing about an 8.x range. The script uses `phpcompatibility-wp` 3.x (PHPCompatibility 10) from its own cache folder, never from the project.

## 1. Resolve the target and the range

1. **Path.** Use the path argument, or the current directory. It must have a top-level PHP file with a `Plugin Name:` header, or a `style.css` with `Theme Name:`. If the directory holds several plugins, ask which one. Run `git -C <path> status --short` and `git -C <path> branch --show-current`, and mention uncommitted changes. Don't switch or create branches unless the user asks.
2. **Versions.** Accept `8.2 8.5`, `8.2-8.5` or `min=8.2 max=8.5`. If either is missing, ask with AskUserQuestion. Show the current `Requires PHP` and suggest the newest released PHP as `<max>`. Use defaults only when no one can answer, and then say so in the summary.
3. **Sanity checks.**
   - If `<min>` is below the current minimum, this is a lowering; confirm it before going on.
   - If you can reach php.net, read https://www.php.net/supported-versions.php for when `<min>` stops getting security fixes. If that is within about six months, put it in the report as a maintainer decision: a higher `<min>` may be the better target.
   - `<max>` must be a released version. The script reports an unreleased one as missing a Docker image.

## 2. Gather the static evidence

```bash
bash <this skill's dir>/scripts/check.sh <path> <min> <max>
```

- **Requirements:** `php` and `composer` on the host. Docker for `php -l` and the install checks.
- **First run:** installs PHPCompatibility into `~/.cache/php-version-bump/` and pulls `php:X.Y-cli` images. After that it takes under a minute.
- **Side effects:** none. It writes nothing in the target. Any check that cannot run prints `SKIPPED: <reason>`, and the run continues.
- **Before reading the output:** if `vendor/` is not installed, run the project's `composer install` first. Otherwise shipped third-party code is not scanned.

Read all of the output:

- **Section 1 (inventory)** is your edit list. Also open every workflow file in `.github/workflows/`. Matrices written as block lists, bash arrays, `include:` entries, `WP_ENV_PHP_VERSION` and single `php-version:` pins in lint, build and release jobs don't all fit one line pattern.
- **Own-code findings** in sections 2–4 are yours to fix.
- **Third-party findings** (`vendor/…`, `vendor-prefixed/…`) are leads, per package. Vendor code often guards these itself. Handle them in step 5c.
- **Section 5 (Composer).** `FAILS` before you change anything is a pre-existing problem; report it as one. Note the lock's `platform-overrides`: if it sits below `<min>`, the lock must be refreshed in step 5a.
- **The repo's own PHPCompatibility.** If the inventory shows 9.x, its existing `testVersion` checks are blind to PHP 8.1+. Report that.

## 3. Runtime baseline on `<max>`

On the unchanged code, run the test suite and the runtime check on `<max>`, following [runtime-checks.md](references/runtime-checks.md). This is the evidence a report needs (deprecations only show at runtime). It is also the baseline that tells pre-existing failures apart from new ones later.

Starting wp-env on a new PHP version takes a minute or two. Keep this `<max>` environment for the step 6 run on `<max>` instead of rebuilding it, but restart it before comparing (see the caching note in the reference).

If Docker or the test runner is unavailable, record it as not run, with the exact command a maintainer should run. Don't present a skipped check as passed.

## 4. Report, then ask

Summarise:
1. **Touchpoints:** each with its current value and the target value.
2. **Own-code findings:** file:line and the PHP version that introduces each.
3. **Third-party findings:** per package, saying whether it ships (`require`) or is dev-only (`require-dev`), and whether a newer release inside the current constraint fixes it (`composer show -a <pkg>`).
4. **Composer state.**
5. **Runtime results on `<max>`.**
6. **Decisions maintainers must make.**
7. **Every check that did not run, and why.**

Then ask with AskUserQuestion: **report only**, or **apply the changes**. Stop after the report if they choose report only. Offer to save it to a file. If no one can answer, stop at the report and say so.

## 5. Apply

Keep the diff to the version bump and the fixes it needs.

### 5a. Declarations and configuration

- **Main file `Requires PHP`:** set to `<min>`. Also update the bootstrap guard to `<min>`: the function that returns the minimum, or the literal in `version_compare( PHP_VERSION, … )`. **Keep the guard.** It protects sites still on an older PHP.
- **`readme.txt` and theme `style.css` `Requires PHP`:** set to `<min>`. If the script reports `MISSING`, add the line to the header block, next to `Requires at least` and matching the block's alignment.
- **README and docs** that state the supported PHP versions: update them.
- **`composer.json` `require.php`:** raise the lower bound to `<min>` in the existing style (`>=7.4` becomes `>=<min>`; `^7.4 || ^8.0` becomes `^<min>`). Don't add an upper bound. If it is absent, add `">=<min>"` only when the project has runtime `require` packages; otherwise list adding it as optional in the summary.
- **`config.platform.php`:** if set, change it to `<min>` in the same format. If it's absent, leave it absent, unless the step 6 install check on `<min>` fails because the lock was resolved on a newer PHP.
- **`composer.lock`:** refresh it only when it needs it:
  - **When it needs it:** you changed `require`, `require-dev`, `config.platform` or `minimum-stability`; or `composer validate` says the lock is out of date; or the lock's `platform`/`platform-overrides` php is below `<min>`. Changing only `scripts` doesn't need a refresh.
  - **How:** with Composer, never by hand: `composer update --lock --no-interaction`. Then `git diff composer.lock` should only touch `content-hash`, `platform`, `platform-overrides` and possibly `plugin-api-version`. Use Composer 2.8 or newer to avoid a `plugin-api-version` downgrade.
  - **If `--lock` cannot resolve:** this is common on `minimum-stability: dev` projects whose locked dev branches have moved on. Don't run `-W` on your own.
    - If the lock needed the refresh, report a blocker with the error, and the package changes `composer update -W --dry-run` would make.
    - If it didn't need one, note the fragile lock as a maintainer decision.
- **`testVersion`:** in phpcs config, composer scripts and workflow `run:` lines. `X-` becomes `<min>-`; `X-Y` becomes `<min>-<max>`.
- **Static analysis:** PHPStan `phpVersion` (`80200` form, or its `min`/`max` object) and Psalm `phpVersion`.
- **CI:**
  - Test matrices list every version from `<min>` to `<max>`. Drop versions below `<min>`.
  - Released versions are normal, required entries, not "experimental" and not `continue-on-error`.
  - Single `php-version` pins in lint, build, docs and release jobs go up to at least `<min>`. Keep a lint job on a version the repo's PHPCS/WPCS can run on.
  - Apply the same to WP × PHP combination lists, E2E PHP variants, and `.wp-env.json` `phpVersion` when it is below `<min>`.

### 5b. Own code

- **PHPCompatibility and `php -l` findings:** fix each with the smallest change.
- **`setAccessible()`:** remove the calls. They have been a no-op since 8.1 and are deprecated in 8.5. If `<min>` is below 8.1, guard them with `PHP_VERSION_ID < 80100` instead.
- **Dead branches:** remove polyfills of functions that are native in `<min>`, together with their `require`s, and branches on PHP version checks below `<min>`. Leave WordPress version checks (`$wp_version`, `get_bloginfo( 'version' )`) alone.
- **Name collisions:** a global, unguarded function named like one PHP adds by `<max>` is a fatal redeclaration. Rename it or guard it.
- **Runtime findings from step 3:** dynamic properties, `null` passed to internal functions, and similar. Declare the property, or cast or default the value.
- **Nothing else:**
  - No syntax modernisation: constructor promotion, `match`, typed properties, `readonly`, new parameter types on public methods or hook callbacks.
  - No `phpcbf` or style churn.
  - No unrelated cleanup.

  List worthwhile modernisations as suggestions in the summary instead.

### 5c. Third-party code

- **Never edit `vendor/` or `vendor-prefixed/`.**
- **Fix within the current constraint:** if a newer release inside the constraint fixes a shipped package, run `composer update <pkg> --with-dependencies` (and the repo's prefixing script, if it has one). Name the package in the summary.
- **Major bump or abandoned package:** report it as a maintainer decision with the evidence (finding counts on `<max>`, the last release date). Don't change it.
- **`require-dev` packages** only affect CI, so they're lower priority. Report them if they stop the tests running on `<max>`.

### 5d. Changelog

Default: leave `CHANGELOG.md` alone and put the entry text in the summary for the PR description. Many projects assemble the changelog at release time. Edit it only if `git log --oneline -15 -- CHANGELOG.md` shows that most of the recent non-release commits touching it are ordinary contributor changes. In that case, add the entry under the unreleased section.

## 6. Verify

1. **Re-run `scripts/check.sh`.** Own-code findings should be gone, and the lock should install on `<min>` and `<max>`.
2. **Tests on `<min>` and `<max>`, runtime check on `<max>`:** follow [runtime-checks.md](references/runtime-checks.md).
   - Compare with the step 3 baseline.
   - A failure that was already there before your changes is pre-existing. Report it as such; don't fix it in this change.
   - If a run is not possible, report it as a **blocker** with the exact command. It is not an optional follow-up.
3. **Lint** with the repo's own PHPCS (`composer lint`, `composer phpcs` or `vendor/bin/phpcs`, whichever it uses), on the PHP version you pinned for the lint job: `docker run --rm -v "$PWD":/app -w /app php:<pin>-cli vendor/bin/phpcs <changed files>`. This proves the new pin works.

## 7. Hand back

- **A table of every check:**
  - PHPCompatibility own and third-party
  - `php -l` per version
  - Composer install on `<min>` and `<max>`
  - tests on each version, with the `Runtime: PHP x.y` PHPUnit printed
  - the runtime check
  - lint

  For each: the version it ran on and the result, or **not run** and why. Never claim a version that did not run.
- **The files you changed.**
- **Decisions left to maintainers.**
- **The changelog entry text,** if it isn't in `CHANGELOG.md`.
- **Optionally,** a recommended permanent compatibility check: the workflow in [runtime-checks.md](references/runtime-checks.md#permanent-compatibility-check). Recommend only. Don't add it in this change.
- **Don't commit, create branches, push or open a PR** unless the user asks.
- **Tear down everything you started** (wp-env, containers). Leave the cached PHPCompatibility install and the `php:X.Y-cli` images; later runs reuse them.
