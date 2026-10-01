# Legacy Shims and Dead Code Catalog

When elevating the minimum supported PHP runtime floor to **PHP 8.2+**, legacy conditional branches, compatibility shims, and polyfills for features introduced in PHP 8.0 and 8.1 become dead code.

This reference provides a definitive catalog of obsolete shims that can be safely pruned, alongside strict guardrails detailing what must be preserved.

---

## 1. Native Functions in PHP 8.0–8.1 (Obsolete Polyfills)

Because the project runtime floor is now elevated (e.g., **PHP 8.0+**, **PHP 8.1+**, or **PHP 8.2+**), functions introduced in or prior to that target floor are guaranteed to be natively available in the PHP engine. Conditional polyfill declarations can be safely removed:

| Function | PHP Version Introduced | Obsolete Shim Pattern to Remove |
|---|---|---|
| `str_contains()` | PHP 8.0 | `if ( ! function_exists( 'str_contains' ) ) { function str_contains( ... ) { ... } }` |
| `str_starts_with()` | PHP 8.0 | `if ( ! function_exists( 'str_starts_with' ) ) { function str_starts_with( ... ) { ... } }` |
| `str_ends_with()` | PHP 8.0 | `if ( ! function_exists( 'str_ends_with' ) ) { function str_ends_with( ... ) { ... } }` |
| `get_debug_type()` | PHP 8.0 | `if ( ! function_exists( 'get_debug_type' ) ) { ... }` |
| `fdiv()` | PHP 8.0 | `if ( ! function_exists( 'fdiv' ) ) { ... }` |
| `preg_last_error_msg()` | PHP 8.0 | `if ( ! function_exists( 'preg_last_error_msg' ) ) { ... }` |
| `array_is_list()` | PHP 8.1 | `if ( ! function_exists( 'array_is_list' ) ) { function array_is_list( ... ) { ... } }` |

### Pruning Rules by Target Floor:
- **Floor raised to PHP 8.0+:** Prune polyfills for `str_contains()`, `str_starts_with()`, `str_ends_with()`, `get_debug_type()`, `fdiv()`, and `preg_last_error_msg()`.
- **Floor raised to PHP 8.1+:** Prune all of the above plus `array_is_list()`.
- **Floor raised to PHP 8.2+:** Prune all PHP 8.0 and 8.1 polyfills and legacy compatibility shims.

### Safety Verification:
Before deleting a polyfill, verify that:
1. The polyfill is defined within plugin/theme source code (not inside a Composer `vendor/` dependency).
2. No third-party caller outside the plugin depends on namespaced wrapper functions.

---

## 2. Obsolete Version Comparison Conditional Blocks

Inspect code for conditional version checks testing against versions lower than the target minimum floor (e.g., `< 8.0`, `< 8.1`, or `< 8.2`):

### A. Dead Conditional Blocks
```php
// BEFORE (Legacy conditional):
if ( version_compare( PHP_VERSION, '8.0', '<' ) ) {
    // Legacy fallback code path (DEAD CODE)
    return $fallback_result;
} else {
    return $modern_result;
}

// AFTER (Cleaned up):
return $modern_result;
```

### B. Obsolete `PHP_VERSION_ID` Guards
```php
// BEFORE (Legacy guard):
if ( PHP_VERSION_ID < 80100 ) {
    // Polyfill or fallback execution (DEAD CODE)
}

// AFTER (Cleaned up):
// Entire conditional block removed.
```

---

## 3. What Must Be Preserved (Safety Guardrails)

To maintain stability and prevent user-facing fatal errors on misconfigured environments, **DO NOT REMOVE** the following defensive mechanisms:

1. **Root Plugin Activation Guards:**
   Retain the root plugin file check preventing the plugin from loading on environments that fail the minimum requirement:
   ```php
   if ( version_compare( PHP_VERSION, '8.0', '<' ) ) {
       add_action( 'admin_notices', 'my_plugin_php_version_notice' );
       return;
   }
   ```
2. **Third-Party Library Workarounds:**
   Do not remove workarounds for known bugs in upstream Composer packages unless the package itself has been updated and verified.
3. **WordPress Core Version Checks:**
   Do not confuse PHP version checks (`PHP_VERSION`) with WordPress version checks (`$wp_version` or `version_compare( $GLOBALS['wp_version'], ... )`). WordPress version checks must remain intact.
