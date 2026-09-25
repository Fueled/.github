---
name: php-version-upgrade
description: Audit and update WordPress plugin or theme repositories to raise minimum PHP support floor and expand tested ceiling with configurable version boundaries (default: PHP 8.2 through 8.5).
license: MIT
compatibility: PHP 8.1-8.5, WordPress 6.4+, Composer, PHPUnit, PHPCS, PHPStan
globs:
  - "*.php"
  - composer.json
  - package.json
  - readme.txt
  - README.md
  - phpcs.xml*
  - phpstan.neon*
  - .github/workflows/*.yml
metadata:
  author: Fueled & 10up
  version: "1.1.0"
---

# PHP Version Support Upgrade Skill

This skill guides you through auditing and updating a WordPress plugin or theme repository to raise its minimum supported runtime floor (default: **PHP 8.2**) and expand tested compatibility through a targeted upper ceiling (default: **PHP 8.5**).

Following the direction outlined in [WooCommerce's PHP version support update](https://developer.woocommerce.com/2026/09/08/from-php-7-4-to-8-1/) and maintainer guidance by Fueled and 10up engineering leads, this skill is fully **parameterized and generic**, allowing developers and AI agents to target any minimum and maximum version combination (e.g., bumping to 8.3 or maintaining an 8.1 baseline) while strictly avoiding unnecessary syntax refactoring.

---

## 🎯 Interactive Invocation & Version Configuration

When invoking this skill, determine the target version boundaries:
- **Target Minimum PHP Version Floor (`targetMin`):** `8.2` (Default for current Fueled/10up initiative)
- **Target Maximum Tested PHP Version Ceiling (`targetMax`):** `8.5` (Default for current Fueled/10up initiative)

### AI Agent Invocation Protocol:
If not explicitly provided in the prompt, the agent may prompt the user:
> *"Please specify the target minimum PHP version [default: 8.2] and tested ceiling [default: 8.5]:"*

If executing in autonomous or pipeline mode without interactive input, fall back to the default baseline: **PHP 8.2 -> PHP 8.5**.

---

## When to Use

- Updating a Fueled or 10up open-source repository to modernize PHP requirements.
- Elevating a plugin or theme's runtime floor (e.g., from PHP 7.x/8.0 to PHP 8.2, or 8.2 to 8.3).
- Expanding GitHub Actions CI pipelines to test across the modernized matrix.
- Remedying PHP deprecation notices (such as dynamic properties, `${var}` string interpolation, or `utf8_encode()`).
- Pruning obsolete polyfills (`str_contains`, `array_is_list`) and dead version checks below the selected minimum floor.

---

## Key Principles & Guardrails

1. **Avoid Unnecessary Refactoring:** Do NOT rewrite stable code solely to adopt newer PHP syntax (e.g. constructor promotion or speculative `match` expressions across legacy classes). Focus strictly on compatibility, test coverage, and stability.
2. **Deterministic Discovery:** Always run the automated detection engine first to obtain an accurate catalog of required updates.
3. **Multi-Version CI Testing:** Ensure tests pass against all supported PHP versions within the selected range (e.g., `8.2`, `8.3`, `8.4`, and `8.5`).
4. **Flag Unresolvable Dependencies:** If an external Composer package does not yet support the target minimum PHP version, flag it for maintainer review rather than applying brittle monkey-patches.

---

## Step-by-Step Procedure

### Step 1: Run Automated Discovery & Audit

Execute the bundled audit script against the repository. The script supports dynamic `--min` and `--max` parameters:

```bash
# Default boundaries (PHP 8.2 -> 8.5)
node scripts/audit_php_versions.mjs [path-to-repo]

# Custom boundaries (e.g. PHP 8.3 -> 8.5, or PHP 8.1 -> 8.5)
node scripts/audit_php_versions.mjs [path-to-repo] --min=8.3 --max=8.5

# Batch auditing across multiple repositories in a parent directory
node scripts/audit_php_versions.mjs --batch=[path-to-parent-dir] --min=8.2 --max=8.5

# Programmatic JSON output for AI pipelines
node scripts/audit_php_versions.mjs [path-to-repo] --json
```

The audit script produces an inventory of:
- Plugin and theme entry headers (`Requires PHP`)
- Readme metadata (`readme.txt`)
- Composer configuration (`require.php`, `config.platform.php`)
- PHPCS compatibility rule configuration (`testVersion`)
- GitHub Actions CI workflow matrices
- Potential code deprecations and obsolete polyfills relative to the selected floor

---

### Step 2: Elevate Metadata & Configuration

Consult [Detection & Tooling Matrix](references/detection-and-tooling-matrix.md) for detailed configuration schemas.

1. **Plugin Entry Header (`*.php`):**
   Update `Requires PHP:` to `<targetMin>` (e.g., `8.2`):
   ```php
   * Requires PHP: 8.2
   ```

2. **WordPress Readme (`readme.txt`):**
   Update `Requires PHP:` to `<targetMin>` (e.g., `8.2`):
   ```text
   Requires PHP: 8.2
   ```

3. **Composer Configuration (`composer.json`):**
   Set the core PHP requirement floor to `>=<targetMin>`:
   ```json
   {
     "require": {
       "php": ">=8.2"
     }
   }
   ```
   If `config.platform.php` is present, set it to `"<targetMin>.0"` (e.g., `"8.2.0"`).

4. **PHP CodeSniffer (`phpcs.xml` or `phpcs.xml.dist`):**
   Update the `testVersion` configuration to audit the full range from `<targetMin>` to `<targetMax>`:
   ```xml
   <config name="testVersion" value="8.2-8.5"/>
   ```

5. **Static Analysis (`phpstan.neon`):**
   Set `phpVersion` parameter to `<targetMinCode>` (e.g., `80200` for 8.2, `80300` for 8.3):
   ```neon
   parameters:
       phpVersion: 80200
   ```

---

### Step 3: Synchronize CI/CD Workflow Matrices

Update GitHub Actions workflows in `.github/workflows/` (e.g. `test.yml`, `phpunit.yml`, `phpcs.yml`) to test across the full version matrix between `<targetMin>` and `<targetMax>`:

```yaml
strategy:
  matrix:
    php: ['8.2', '8.3', '8.4', '8.5']
    include:
      - php: '8.5'
        experimental: true
```

*Note: Use `continue-on-error: ${{ matrix.experimental || false }}` for pre-GA PHP versions (like 8.5) until upstream runner environments reach stable GA release.*

---

### Step 4: Remediate Deprecations & Incompatibilities

Consult [PHP 8.2–8.5 Deprecations Reference](references/php82-85-deprecations.md) for full remediation examples.

1. **Dynamic Properties (PHP 8.2+):**
   - Preferred: Declare class properties explicitly with appropriate types and default values.
   - Alternative: Apply the `#[\AllowDynamicProperties]` attribute to legacy container classes.
2. **String Interpolation (PHP 8.2+):**
   - Replace `${var}` with `{$var}` or `$var`.
3. **Deprecated UTF-8 Encoding Functions (PHP 8.2+):**
   - Replace `utf8_encode( $str )` with `mb_convert_encoding( $str, 'UTF-8', 'ISO-8859-1' )`.
   - Replace `utf8_decode( $str )` with `mb_convert_encoding( $str, 'ISO-8859-1', 'UTF-8' )`.
4. **Obsolete INI Directives (PHP 8.1+):**
   - Remove `ini_set( 'auto_detect_line_endings', ... )`.
5. **Implicitly Nullable Parameters (PHP 8.4+):**
   - Change `function example( string $param = null )` to `function example( ?string $param = null )`.

---

### Step 5: Prune Legacy Shims & Dead Code

Consult [Legacy Shims Catalog](references/legacy-shims-catalog.md) for complete inventory.

1. **Prune Native Function Polyfills:**
   Safely remove custom or conditional fallback implementations for functions native in PHP versions at or below `<targetMin>`:
   - For PHP >= 8.0: `str_contains()`, `str_starts_with()`, `str_ends_with()`, `get_debug_type()`
   - For PHP >= 8.1: `array_is_list()`
2. **Remove Dead Version Checks:**
   Remove dead branches conditioned on `version_compare( PHP_VERSION, '<older_ver>', '<' )` where `<older_ver>` <= `<targetMin>`.
3. **Preserve Defensive Runtime Guards:**
   Retain the root plugin bootstrap check preventing execution on older PHP versions to protect users on misconfigured servers:
   ```php
   if ( version_compare( PHP_VERSION, '8.2', '<' ) ) {
       add_action( 'admin_notices', 'my_plugin_php_version_notice' );
       return;
   }
   ```

---

### Step 6: Local Quality Assurance & Verification

Execute the project's quality verification suite locally:

```bash
# 1. Validate PHP syntax
find . -name "*.php" -not -path "./vendor/*" -not -path "./node_modules/*" -exec php -l {} \;

# 2. Run PHP CodeSniffer with PHPCompatibility
composer run lint || vendor/bin/phpcs --runtime-set testVersion 8.2-8.5

# 3. Run Static Analysis
composer run phpstan || vendor/bin/phpstan analyze

# 4. Run Test Suite
composer run test || vendor/bin/phpunit
```

---

### Step 7: Pull Request Packaging & Review Guidelines

Consult [Targeted Modernizations Guardrails](references/targeted-modernizations.md) before finalizing the PR diff.

1. **Review Diff Compactness:** Ensure no unrelated whitespace churn or purely stylistic rewrites are included.
2. **Draft PR Creation:** Open the PR as a Draft to facilitate maintainer review.
3. **PR Description Checklist:**
   - [x] Raised minimum supported PHP version floor to `<targetMin>` (e.g. 8.2)
   - [x] Raised tested PHP version ceiling to `<targetMax>` (e.g. 8.5)
   - [x] Updated plugin header and `readme.txt`
   - [x] Updated `composer.json` and PHPCS `testVersion`
   - [x] Updated GitHub Actions CI test matrices
   - [x] Resolved PHP deprecation notices
   - [x] Pruned dead polyfills native in PHP <= `<targetMin>`
   - [x] Local PHPCS, PHPStan, and PHPUnit suites passing clean

---

## Detailed References

- [Detection and Tooling Configuration Matrix](references/detection-and-tooling-matrix.md)
- [PHP 8.2–8.5 Deprecations and Incompatibilities Reference](references/php82-85-deprecations.md)
- [Legacy Shims and Dead Code Catalog](references/legacy-shims-catalog.md)
- [Targeted Value-Add Modernization Guardrails](references/targeted-modernizations.md)
