# Detection and Tooling Configuration Matrix

This reference specifies the deterministic configuration, metadata, and continuous integration settings required when upgrading a WordPress plugin or theme repository to support **PHP 8.0 through PHP 8.5** (or any custom target range specified via `--min` and `--max`).

---

## 1. Version Floor and Ceiling Standard

Using **PHP 8.0** as the flexible baseline floor example (adjustable via `--min`):

| Property | Value | Rationale |
|---|---|---|
| **Minimum Floor** | `8.0` | Flexible baseline floor; lowest modern PHP 8.x series, providing a modern foundation. |
| **Maximum Ceiling** | `8.5` | Next-generation PHP target; ensures proactive compatibility and zero surprise deprecations upon general availability. |
| **Test Matrix** | `['8.0', '8.1', '8.2', '8.3', '8.4', '8.5']` | Comprehensive multi-version matrix verifying LTS stability and forward compatibility. |

*Note: When targeting a higher floor (such as PHP 8.2 or 8.3), parameterize accordingly (e.g., minimum floor `8.2` and matrix `['8.2', '8.3', '8.4', '8.5']`).*

---

## 2. Plugin & Theme Metadata Headers

### A. Main Plugin Entry Point (`*.php`)
Locate the root plugin header block in the entry PHP file (e.g. `plugin-name.php`). Ensure `Requires PHP` is present and set to `<targetMin>` (e.g. `8.0`):

```php
/**
 * Plugin Name:       Example Plugin
 * Plugin URI:        https://example.com/example-plugin
 * Description:       Modern WordPress solution.
 * Version:           1.4.0
 * Requires at least: 6.4
 * Requires PHP:      8.0
 * Author:            Plugin Author
 * License:           GPL-2.0-or-later
 */
```

### B. WordPress.org Readme (`readme.txt`)
In the header section of `readme.txt`, synchronize the `Requires PHP` directive:

```text
=== Example Plugin ===
Contributors: exampleauthor
Tags: modern, blocks, workflow
Requires at least: 6.4
Tested up to: 6.7
Requires PHP: 8.0
Stable tag: 1.4.0
License: GPLv2 or later
```

### C. WordPress Theme Stylesheet (`style.css`)
If upgrading a theme or child theme, update the stylesheet header:

```css
/*
Theme Name: Example Theme
Theme URI: https://example.com/example-theme
Author: Theme Author
Requires at least: 6.4
Requires PHP: 8.0
Version: 1.0.0
*/
```

---

## 3. Dependency Management (`composer.json`)

### A. Core PHP Requirement
Update `require.php` to enforce `<targetMin>` as the minimum runtime requirement (e.g. `8.0`):

```json
{
  "require": {
    "php": ">=8.0"
  }
}
```
*Note: If the repository uses caret syntax for minor version locking, use `"php": "^8.0 || ^8.1 || ^8.2 || ^8.3 || ^8.4 || ^8.5"`.*

### B. Platform Emulation (Optional)
If `config.platform.php` is specified, align it to the minimum supported floor to prevent installing packages requiring higher PHP features during CI dependency resolution:

```json
{
  "config": {
    "platform": {
      "php": "8.0.0"
    }
  }
}
```

---

## 4. Code Standards & Linter Configurations

### A. PHP CodeSniffer (`phpcs.xml` or `phpcs.xml.dist`)
Ensure `PHPCompatibility` / `PHPCompatibilityWP` is configured to audit the exact `<targetMin>-<targetMax>` version range (e.g. `8.0-8.5`):

```xml
<?xml version="1.0"?>
<ruleset name="WordPress Plugin Coding Standards">
    <description>Coding standards for Example Plugin.</description>

    <!-- Enforce PHP 8.0-8.5 compatibility checks -->
    <config name="testVersion" value="8.0-8.5"/>

    <!-- Include PHPCompatibility rules -->
    <rule ref="PHPCompatibilityWP"/>
</ruleset>
```

### B. Command-Line Runtime Override
When running `phpcs` via CLI or npm scripts, update any inline `--runtime-set` arguments:

```bash
vendor/bin/phpcs -p -s -v -n . --standard=phpcs.xml --runtime-set testVersion 8.0-8.5
```

---

## 5. Static Analysis Configuration

### A. PHPStan (`phpstan.neon` or `phpstan.neon.dist`)
Set the target analysis `phpVersion` parameter to `<targetMinCode>` (e.g. `80000` for PHP 8.0, `80200` for PHP 8.2):

```neon
parameters:
    level: 8
    phpVersion: 80000
    paths:
        - src/
        - includes/
```

### B. Psalm (`psalm.xml`)
Set `phpVersion` attribute on the root `<psalm>` element:

```xml
<psalm
    errorLevel="3"
    phpVersion="8.0"
    resolveFromConfigFile="true"
>
```

---

## 6. GitHub Actions CI/CD Workflow Matrices

### A. Standard PHP Testing Matrix
Update `.github/workflows/test.yml` (or `phpunit.yml` / `lint.yml`) to include the configured PHP matrix (e.g. PHP 8.0 through 8.5):

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        php: ['8.0', '8.1', '8.2', '8.3', '8.4', '8.5']
        wordpress: ['latest']
        include:
          - php: '8.5'
            experimental: true

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ matrix.php }}
          extensions: mbstring, xml, ctype, iconv
          coverage: none

      - name: Run PHPUnit
        continue-on-error: ${{ matrix.experimental || false }}
        run: vendor/bin/phpunit
```

### B. Experimental Handling for PHP 8.5
Because PHP 8.5 is in active pre-release development, mark PHP 8.5 as `experimental: true` and configure `continue-on-error: ${{ matrix.experimental || false }}` where upstream container images or nightly build tooling may experience upstream volatility.
