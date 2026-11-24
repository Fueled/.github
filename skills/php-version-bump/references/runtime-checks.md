# Runtime checks

Static checks cannot see dynamic properties, `null` passed to internal functions, `setAccessible()`, or deprecations in bundled libraries that only fire when called. These checks run the code.

Use the repo's own scripts to start, stop and run things, and use the same tool to tear down what you started. If the repo has no wp-env script, use `npx --yes @wordpress/env` (the bare `wp-env` npm package is a different project).

## Tests on one PHP version

1. **Find the runner.** Look at `package.json` and `composer.json` `scripts` (`test:php`, `test`, `env:start`), `phpunit.xml*`, `.wp-env.json`, and the `run:` lines of the test workflow. The workflow shows how CI really runs them.
2. **Run it on version `<v>`:**
   - **wp-env suites.** Before starting, check `docker ps` for port clashes. If needed, set `WP_ENV_PORT` and `WP_ENV_TESTS_PORT` to free ports, and never stop an environment you didn't start. Then:
     ```bash
     WP_ENV_PHP_VERSION=<v> npm run env:start   # or: WP_ENV_PHP_VERSION=<v> npx --yes @wordpress/env start
     npm run test:php                           # whatever the repo's script is
     ```
     `WP_ENV_PHP_VERSION` overrides `phpVersion` in `.wp-env.json`. A leftover `.wp-env.override.json` can pin other settings; check for one. To switch versions, stop the environment and start it again with the new value.
   - **Suites that only need PHP and `vendor/`** (WP_Mock, plain PHPUnit):
     ```bash
     docker run --rm -v "$PWD":/app -w /app php:<v>-cli vendor/bin/phpunit
     ```
     Add the PHP extensions the suite needs if the base image lacks them.
   - **`bin/install-wp-tests.sh` suites need MySQL.** Run them if the repo provides a database (some workflows show how); otherwise mark them not run, with the commands.
3. **Confirm the version.** Read the `Runtime: PHP x.y` line in PHPUnit's output. PHPUnit 9 prints it only with `--verbose`; pass that through the repo's command (for example `npm run test:php -- --verbose`, if the script ends in the phpunit call), or run `php -v` in the same container (`<wp-env> run tests-cli php -v`). Record the tests, assertions, errors, failures, deprecations and skipped counts.
4. **A failure after your changes:** run the same test on the unchanged code (`git stash`, run, `git stash pop`) before calling it new.

## Runtime check on `<max>`

Use the wp-env development site (not the tests site), started on `<max>`.

1. **Turn on logging.** If `.wp-env.json` `config` already sets `WP_DEBUG_LOG` to a path, use that path below instead of `wp-content/debug.log`, and don't override it. Otherwise:
   ```bash
   <wp-env> run cli wp config set WP_DEBUG true --raw
   <wp-env> run cli wp config set WP_DEBUG_LOG true --raw
   <wp-env> run cli wp config set WP_DEBUG_DISPLAY false --raw
   ```
2. **Activate the plugin** (`wp plugin activate <slug>`), or the theme. Then empty the log, `<wp-env> run cli sh -c ': > wp-content/debug.log'`, and prove logging works: `<wp-env> run cli wp eval 'trigger_error( "php-version-bump probe", E_USER_DEPRECATED );'`. The probe line must appear in the log. Without it, an empty log could just mean logging is broken.
3. **Exercise it** as a logged-in administrator. Log in once and reuse the cookie jar:
   ```bash
   curl -s -c jar -b 'wordpress_test_cookie=WP%20Cookie%20check' \
     -d 'log=admin&pwd=password&wp-submit=Log%20In&testcookie=1' http://localhost:<port>/wp-login.php -o /dev/null
   curl -s -b jar -o /dev/null -w '%{http_code} %{url_effective}\n' http://localhost:<port>/wp-admin/<page>
   ```
   Find what to load with `grep -rnE "add_(menu|submenu|options|management|theme)_page|register_post_type|register_rest_route|wp_ajax_|admin_post_|add_shortcode|register_block_type|WP_CLI::add_command" --include=*.php` over the own code. Then load:
   - **Admin screens:** `admin.php?page=<slug>` (or the matching parent file) for each menu page, and `plugins.php`. For each post type it registers or edits: `edit.php?post_type=<type>`, `post-new.php?post_type=<type>`, and `post.php?post=<id>&action=edit` for an item created with `wp post create`.
   - **AJAX and admin-post handlers:** call them with the nonce the page prints (scrape it from the screen that uses it), or they return 403 without running.
   - **Front end:** the home page, a single post, and the plugin's main behaviour (for example its redirects, block or shortcode output, on content created with `wp post create`).
   - **REST routes:** its GET routes (`/wp-json/<namespace>`).
   - **WP-CLI commands** it registers, with harmless arguments (list, export, a dry run).
   - **Scheduled work:** `<wp-env> run cli wp cron event run --due-now`.

   Make sure at least one request runs each function you changed in step 5. Say which changed code was not exercised.
4. **Read the log:** `<wp-env> run cli cat wp-content/debug.log`. Group entries by origin:
   - the plugin's own files
   - its bundled third-party code (`vendor/`, `vendor-prefixed/`, other bundled libraries)
   - core and other plugins (ignore these, beyond a mention)

   Report each URL's HTTP status (a 500 is a finding).
5. **Caches can hide deprecations.** Compare before and after only after a full stop and start of the environment.
6. **Without Docker or wp-env,** mark the check not run and list these steps for a maintainer.

## Permanent compatibility check

Recommend this as a follow-up for maintainers to decide; don't add it as part of the bump. It installs PHPCompatibility 10 outside the project, because the 10.x pre-releases need PHPCS 4 while WPCS 3 needs PHPCS 3. Pin the actions to commit SHAs the way the repo's other workflows do.

```yaml
name: PHP Compatibility

on:
  pull_request:
  push:
    branches: [develop, trunk]

permissions: {}

jobs:
  phpcompat:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@<sha> # vX
      - uses: shivammathur/setup-php@<sha> # vX
        with:
          php-version: '<max>'
          tools: composer
          coverage: none
      - name: Install PHPCompatibilityWP 3.x
        run: |
          mkdir -p "$RUNNER_TEMP/phpcompat" && cd "$RUNNER_TEMP/phpcompat"
          composer init --no-interaction --name local/phpcompat --stability alpha
          composer config allow-plugins.dealerdirect/phpcodesniffer-composer-installer true
          composer require --no-interaction "phpcompatibility/phpcompatibility-wp:^3.0@alpha"
      - name: Scan
        run: |
          "$RUNNER_TEMP/phpcompat/vendor/bin/phpcs" -p --extensions=php --standard=PHPCompatibilityWP \
            --runtime-set testVersion <min>- --ignore='*/vendor/*,*/node_modules/*,*/vendor-prefixed/*' .
```

Once `phpcompatibility-wp` 3.0 is stable and WPCS supports PHPCS 4, this can move into the project's own `require-dev` and phpcs config.
