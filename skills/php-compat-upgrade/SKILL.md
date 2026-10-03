---
name: php-compat-upgrade
description: Audit and raise a WordPress plugin's supported PHP version range (default 8.2-8.5). Detects the current min/max, scans with PHPCompatibilityWP (plugin code and vendor dependencies separately), then either produces a report or applies fixes across composer.json, plugin metadata, phpcs/static-analysis config, CI matrices, and docs — running the test suite to verify. Use when asked to check, audit, or raise PHP version/compatibility support for a WordPress plugin, or to run a PHPCompatibility scan.
---

# PHP Compatibility Upgrade

Audits and (optionally) upgrades a single WordPress plugin's supported PHP range. Default target range is **8.2-8.5**; treat any explicit range given in the invocation args (e.g. `8.1-8.4`) as an override.

## 0. Resolve target plugin and range

- If an argument names a plugin path, use it. Otherwise, if the current working directory is inside a plugin (has a `composer.json` or a main plugin file with a `Plugin Name:` header), use that. Otherwise, if run from the `10up` workspace root, list the directories under `plugins/` and ask which one to target — don't guess across multiple plugins.
- Confirm the target PHP range (default `8.2-8.5`) before proceeding if the invocation didn't specify one explicitly and the detected current range (step 1) is unusual (e.g. already exceeds 8.5, or the plugin looks abandoned/pre-1.0).

## 1. Detect current range

Check, and report before doing anything else:

- `composer.json` → `require.php`
- Main plugin file header → `Requires PHP:`
- `readme.txt` → `Requires PHP:`
- Any existing `phpcs.xml`/`phpcs.xml.dist` → PHPCompatibility `testVersion` config, if present
- Any `phpstan.neon`/`psalm.xml` → configured PHP version target, if present
- CI workflows (`.github/workflows/*.yml`) → PHP version matrix (test workflows) and single PHP version used for lint/build workflows
- `.wp-env.json` / `tests/bin/*` if present → PHP version pinned for the local test environment

Summarize the detected min/max plainly before moving on.

## 2. Ensure PHPCompatibilityWP is available

PHPCompatibilityWP is a permanent tool this workflow leaves in the codebase — never install it just for this scan and remove it afterward. Check how it's currently available and bring it up to a properly-declared state:

- **Direct `require-dev` entry, already configured in `phpcs.xml`** (a `PHPCompatibilityWP` rule ref with a `testVersion`): nothing to add. Just update the existing `testVersion` to the target range in step 4/6b.
- **Direct `require-dev` entry, but not yet wired into `phpcs.xml`**: leave the dependency as-is; adding the rule ref happens in step 6b (make-the-updates mode) or is noted as a recommendation in the report (report-only mode).
- **Only transitively available** — resolvable in `vendor/`/`composer.lock` only because another `require-dev` package happens to pull it in (e.g. a shared `phpcs-composer` standard), with no direct entry of its own: add an explicit `phpcompatibility/phpcompatibility-wp` entry to `composer.json` `require-dev`, pinned to whatever version is already resolved (`composer show phpcompatibility/phpcompatibility-wp`), then run `composer update phpcompatibility/phpcompatibility-wp --with-all-dependencies` so `composer.lock` records it as a direct dependency. Do this **before** wiring any permanent `phpcs.xml` rule ref to it — a `testVersion` config pointing at a sniff the project doesn't directly declare will break the moment the transitive package's own dependencies shift (e.g. a `dev-master` branch update).
- **Absent entirely**: `composer require --dev phpcompatibility/phpcompatibility-wp --with-all-dependencies` to add it as a real, permanent dependency.
- **Pin the Composer platform to the minimum PHP** (`composer config platform.php <min>.0`) before running any `composer update`/`require`, so the lock resolves for the lowest supported version. Without it, running on a newer local PHP can lock packages that don't install on the minimum (e.g. `doctrine/instantiator` 2.1 needs PHP ^8.4).
- **Scope every update to the named package** (`composer update <pkg> --with-dependencies`); avoid blanket `--with-all-dependencies`, which can jump unrelated majors. After any lock change, diff it and flag major bumps. For wp-phpunit projects, keep `phpunit/phpunit` at `^9.6` — the WP test library doesn't run on PHPUnit 10+.
- Handle `dealerdirect/phpcodesniffer-composer-installer` — it needs `"allow-plugins"` set to `true` in `composer.json` `config` (composer will prompt/fail otherwise); if the project doesn't already allow it, set that permanently as part of this change.
- If this step changes `composer.json`/`composer.lock` (moving the package from absent/transitive to a direct dependency), that's an intentional, permanent addition — not a temporary scratch install to clean up later. Flag it plainly in the step 4 summary so the user knows the dependency tree changed, including in report-only mode.

- **Confirm phpcs itself runs** on the newest PHP in the range (`vendor/bin/phpcs .`). Old standards (e.g. `10up/phpcs-composer` on `dev-master`, with an outdated WPCS) crash with PHP 8.4+ deprecations before any sniff runs; upgrade the standard (e.g. `^3.0`) so the compatibility scan can execute, and fix any style errors it then surfaces (`phpcbf`, committed separately from the version changes).

## 3. Run the scan — two separate passes

**Pass A — the plugin's own code**
```
vendor/bin/phpcs --standard=PHPCompatibilityWP --runtime-set testVersion <range> <plugin-src-paths>
```
Exclude `vendor`, `node_modules`, `dist`, `tests` (mirror the project's own `phpcs.xml` excludes if present). Findings here are candidates for direct fixes in step 6b.

**Pass B — vendor dependencies**
```
vendor/bin/phpcs --standard=PHPCompatibilityWP --runtime-set testVersion <range> vendor/
```
Scope this to packages actually declared in the plugin's own `composer.json` (`require` and `require-dev`) — don't chase transitive noise beyond that. For each flagged file, map it back to its package via the `vendor/<vendor>/<package>/` path.

- **Never edit anything under `vendor/`** — it's composer-managed and gets overwritten on install.
- Distinguish `require` (ships to production, matters most) from `require-dev` (only runs in CI/tooling, lower priority).
- For each flagged package, check `composer show <pkg> --all` to see whether a version already satisfies the fix:
  - Fix available **within** the current composer.json constraint → safe to auto-apply via `composer update <pkg>` in auto-fix mode.
  - Fix requires loosening/raising the constraint (especially a major bump) → report only, never auto-applied. A major bump can break the plugin for reasons unrelated to PHP compatibility, so it needs a human decision.
- Note in the report that PHPCompatibility sniffs vendor code the same as first-party code, so it can flag code paths a package already guards with its own version checks — treat vendor findings as "worth reviewing," not certain.

## 4. Read and summarize the results

Group findings by: deprecations, removed/changed functions, incompatible syntax, each with file:line and which PHP version in the range introduces the issue. Keep Pass A (own code) and Pass B (vendor) clearly separated in the summary.

## 5. Ask before doing anything to the repo

Use `AskUserQuestion` (or the equivalent direct question if not available): **"report only"** vs **"make the updates"**. Do not proceed past this point without an explicit choice.

## 6a. Report only

Present the findings from step 4 in chat, plus the always-advisory sections in step 7. Offer to save it as a markdown file if the user wants something to share — don't write files unless asked. If step 2 added or promoted `phpcompatibility/phpcompatibility-wp` to a permanent dependency to run the scan, leave that in place — it's not reverted in report-only mode, since it's meant to stay in the codebase either way.

## 6b. Make the updates

- Create a branch, e.g. `php-<range>-compat` (e.g. `php-8.2-8.5-compat`), don't commit to the current branch directly.
- Apply:
  - `composer.json` → `"php": ">=<min>"` (composer constraints express a minimum; the max is enforced via CI matrix + PHPCompatibility `testVersion`, not a composer upper bound, unless the project already used one)
  - Plugin header → `Requires PHP: <min>`
  - `readme.txt` → `Requires PHP: <min>` (note: WP.org readme.txt has no "max PHP" field — max support only shows up in CI/tooling, not readme.txt)
  - `phpcs.xml` (and `phpstan.neon`/`psalm.xml` if present) → PHP target range/`testVersion` updated to `<range>`
  - CI workflow PHP matrices → the full target range (e.g. `['8.2','8.3','8.4','8.5']`), dropping versions below the new minimum; also bump any single pinned PHP version used by lint/build-only workflows to at least the new minimum
  - Apply the Pass A phpcs-flagged fixes directly
  - Apply Pass B vendor fixes that are safe per step 3 (`composer update <pkg>` only where the fix is within the existing constraint)
  - Remove now-dead version shims/conditionals found via grep (`version_compare( PHP_VERSION, ...)`, `PHP_VERSION_ID <` guards, polyfills for things natively available at the new minimum) — simplify, don't leave dead branches behind
  - Update `README.md`/`CHANGELOG.md` mentions of the supported PHP range, and add a changelog entry for the bump
  - Search `tests/` too for polyfills of functions native at the new minimum (e.g. `function_exists( 'str_contains' )` shims in test bootstraps) and remove them with their `require`s
- **Run the test suite** before calling this done:
  - Detect it: `composer.json`/`package.json` `scripts` (`test`, `test:php`), `phpunit.xml.dist`, `tests/`, `.wp-env.json`.
  - Run whatever's found (e.g. `npm run env:start` then `npm run test:php` for wp-env-based projects). If the runner needs Docker and it's unavailable, say so explicitly rather than skipping silently.
  - Before finishing, dry-run `composer install` under each PHP version in the range (temp copy of `composer.json`/`composer.lock` with `platform.php` set per version) to confirm the lock installs everywhere.
  - State which PHP version(s) the tests actually ran on; a local run on one version doesn't verify the rest of the matrix.
  - Commit the changes on the branch either way, so work isn't lost — but the commit message and your summary to the user must state test results plainly: pass, fail (with which tests/why), or "no test setup detected." Never imply "done" if tests failed or couldn't run.

## 7. Always include, report or auto-fix — advisory only, never auto-applied

- Third-party dependency constraints that look too old to guarantee support for the target range, beyond what Pass B already caught (e.g. abandoned packages, packages with no recent releases) — flag for manual review.
- Targeted PHP `<min>`+ opportunities (readonly properties, enums, first-class callable syntax, etc.) where they'd meaningfully improve the code — list as suggestions only. Do not apply these, even in auto-fix mode: the ask was to raise the compatibility floor, not to refactor for newer syntax.

## Guardrails

- Never push or open a PR — stop after the local branch + commit (or after the report) and hand back to the user.
- Never touch `vendor/` files directly.
- Multiple plugins may be on the same branch name; always confirm which repo you're operating in (`git -C <plugin> branch --show-current`) before editing or committing.
- Never remove PHPCompatibilityWP once it's a dependency — it's permanent, kept in the codebase for repeat compatibility checks, not a scratch tool to uninstall after the scan.
- Before wiring a permanent `PHPCompatibilityWP` rule ref + `testVersion` into `phpcs.xml`, confirm the package is a direct `require-dev` entry (not merely transitive) — a rule ref to an undeclared sniff will break on a future `composer update`.

## Success
`<min>` and `<max>` below are the target range resolved in step 0 (default `8.2` and `8.5`, or the range given in the invocation args). Ensure the following is true:
- Raised the minimum supported PHP version to `<min>`
- Ensured the project supports and is tested through PHP `<max>`
- Update composer.json, plugin/package metadata, CI workflows, compatibility tooling, static analysis, readmes/docs, and related configuration as applicable
- Updated dependencies where necessary for PHP `<min>`–`<max>` compatibility
- Removed or simplified compatibility code that only exists to support PHP versions below `<min>` where appropriate
- Addressed PHP `<min>`–`<max>` deprecations, compatibility issues, or test failures identified by the skill
- Updated relevant documentation to reflect the new supported PHP range (`<min>`–`<max>`)
- All tests pass for the given PHP range — locally for the versions actually run, and in the CI matrix once the user pushes (the skill can't claim versions it didn't run; if CI fails after pushing, treat the failing step's log as the next input)
