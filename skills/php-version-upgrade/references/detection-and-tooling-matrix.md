# Detection and Tooling Configuration Matrix

This reference specifies the deterministic configuration, metadata, and continuous integration settings required when upgrading a WordPress plugin or theme repository to support **PHP 8.2 through PHP 8.5**.

---

## 1. Version Floor and Ceiling Standard

| Property | Value | Rationale |
|---|---|---|
| **Minimum Floor** | `8.2` | Minimum PHP version receiving active/security fixes; widely adopted across modern hosting and enterprise infrastructure. |
| **Maximum Ceiling** | `8.5` | Next-generation PHP target; ensures proactive compatibility and zero surprise deprecations upon general availability. |
| **Test Matrix** | `['8.2', '8.3', '8.4', '8.5']` | Comprehensive multi-version matrix verifying LTS stability and forward compatibility. |

---

## 2. Plugin & Theme Metadata Headers

### A. Main Plugin Entry Point (`*.php`)
Locate the root plugin header block in the entry PHP file (e.g. `plugin-name.php`). Ensure `Requires PHP` is present and set to `8.2`:

```php
/**
 * Plugin Name:       Example 10up Plugin
 * Plugin URI:        https://github.com/10up/example-plugin
 * Description:       Enterprise-grade WordPress solution.
 * Version:           1.4.0
 * Requires at least: 6.4
 * Requires PHP:      8.2
 * Author:            10up
 * License:           GPL-2.0-or-later
 */
```

### B. WordPress.org Readme (`readme.txt`)
In the header section of `readme.txt`, synchronize the `Requires PHP` directive:

```text
=== Example 10up Plugin ===
Contributors: 10up
Tags: enterprise, blocks, workflow
Requires at least: 6.4
Tested up to: 6.7
Requires PHP: 8.2
Stable tag: 1.4.0
License: GPLv2 or later
```

### C. WordPress Theme Stylesheet (`style.css`)
If upgrading a theme or child theme, update the stylesheet header:

```css
/*
Theme Name: Example Theme
Theme URI: https://github.com/Fueled/example-theme
Author: Fueled
Requires at least: 6.4
Requires PHP: 8.2
Version: 1.0.0
*/
```

---

## 3. Dependency Management (`composer.json`)

### A. Core PHP Requirement
Update `require.php` to enforce PHP 8.2 as the minimum runtime requirement:

```json
{
  "require": {
    "php": ">=8.2"
  }
}
```
*Note: If the repository uses caret syntax for minor version locking, use `"php": "^8.2 || ^8.3 || ^8.4 || ^8.5"`.*

### B. Platform Emulation (Optional)
If `config.platform.php` is specified, align it to the minimum supported floor to prevent installing packages requiring higher PHP features during CI dependency resolution:

```json
{
  "config": {
    "platform": {
      "php": "8.2.0"
    }
  }
}
```

---

## 4. Code Standards & Linter Configurations

### A. PHP CodeSniffer (`phpcs.xml` or `phpcs.xml.dist`)
Ensure `PHPCompatibility` / `PHPCompatibilityWP` is configured to audit the exact `8.2-8.5` version range:

```xml
<?xml version="1.0"?>
<ruleset name="WordPress Plugin Coding Standards">
    <description>Coding standards for Example Plugin.</description>

    <!-- Enforce PHP 8.2-8.5 compatibility checks -->
    <config name="testVersion" value="8.2-8.5"/>

    <!-- Include PHPCompatibility rules -->
    <rule ref="PHPCompatibilityWP"/>
</ruleset>
```

### B. Command-Line Runtime Override
When running `phpcs` via CLI or npm scripts, update any inline `--runtime-set` arguments:

```bash
vendor/bin/phpcs -p -s -v -n . --standard=phpcs.xml --runtime-set testVersion 8.2-8.5
```

---

## 5. Static Analysis Configuration

### A. PHPStan (`phpstan.neon` or `phpstan.neon.dist`)
Set the target analysis `phpVersion` parameter to `80200` (representing PHP 8.2.0):

```neon
parameters:
    level: 8
    phpVersion: 80200
    paths:
        - src/
        - includes/
```

### B. Psalm (`psalm.xml`)
Set `phpVersion` attribute on the root `<psalm>` element:

```xml
<psalm
    errorLevel="3"
    phpVersion="8.2"
    resolveFromConfigFile="true"
>
```

---

## 6. GitHub Actions CI/CD Workflow Matrices

### A. Standard PHP Testing Matrix
Update `.github/workflows/test.yml` (or `phpunit.yml` / `lint.yml`) to include PHP 8.2 through 8.5:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        php: ['8.2', '8.3', '8.4', '8.5']
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
