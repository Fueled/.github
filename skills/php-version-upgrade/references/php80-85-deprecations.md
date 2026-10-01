# PHP 8.0–8.5 Deprecations and Incompatibilities Reference

This document provides a comprehensive technical guide to breaking changes, deprecation notices, and migration patterns for PHP 8.0 through PHP 8.5 within the WordPress open-source ecosystem.

---

## 1. PHP 8.0 Deprecations & Breaking Changes

### A. Non-Numeric String Comparisons
**Issue:** In PHP 8.0, comparisons between numbers and non-numeric strings changed. In PHP 7.x, `0 == 'foobar'` evaluated to `true` because `'foobar'` was cast to integer `0`. In PHP 8.0+, PHP only casts the string to a number if it is actually numeric; otherwise, the number is converted to a string (`"0" == "foobar"`), evaluating to `false`.
```php
// PHP 7.x: true
// PHP 8.0+: false
0 == 'foobar';
```

**Remediation:** Use strict identity comparison (`===`), or explicit numeric verification:
```php
// Compliant:
if ( is_numeric( $val ) && (int) $val === 0 ) { ... }
// Or strict comparison:
if ( $val === 0 || $val === '0' ) { ... }
```

---

### B. Fatal `TypeError` and `ValueError` on Internal Functions
**Issue:** In PHP 8.0+, internal PHP functions throw `TypeError` or `ValueError` exceptions when passed illegal arguments or out-of-range values, rather than emitting a warning and returning `false` or `null`.
```php
// PHP 8.0+: throws ValueError
strlen( '' ); // Valid
array_chunk( [], -1 ); // Throws ValueError
```

**Remediation:** Validate arguments before invoking internal functions, or wrap boundary calls in `try ... catch ( ValueError | TypeError $e )`.

---

### C. Removal of Legacy Functions & Syntax
**Issue:** Several functions and syntactic constructs deprecated in PHP 7.x were permanently removed in PHP 8.0:
- `create_function()` removed: Triggers fatal error. Replace with anonymous functions (closures) `function() {}`.
- `each()` removed: Replace with `foreach` loops or `key()` / `current()`.
- `money_format()` removed: Replace with `NumberFormatter::formatCurrency()`.
- `(unset)` cast removed: Replace with `$var = null` or `unset( $var )`.
- `restore_include_path()` removed: Replace with `ini_restore( 'include_path' )`.
- `track_errors` ini directive and `$php_errormsg` removed: Replace with `error_get_last()`.

---

### D. Stricter Arithmetic and Bitwise Operators
**Issue:** In PHP 8.0+, using arithmetic operators (`+`, `-`, `*`, `/`, `%`, `**`) or bitwise operators (`&`, `|`, `^`, `~`, `<<`, `>>`) on arrays, resources, or non-numeric objects throws a `TypeError` instead of producing notices.

**Remediation:** Ensure operands are verified numbers or use array union `+` strictly between arrays.

---

### E. Method Inheritance Signature Checks (LSP Enforcement)
**Issue:** Child classes overriding parent methods with incompatible parameter types emit a fatal `Fatal error: Declaration of Child::method(...) must be compatible with Parent::method(...)` instead of a warning.

**Remediation:** Align child method signatures to match parent class contracts, including nullable types and default parameter values.

---

## 2. PHP 8.1 Deprecations & Breaking Changes

### A. Passing `null` to Non-Nullable Internal Functions
**Issue:** Passing `null` to scalar parameters of internal functions that do not accept `null` triggers a deprecation notice in PHP 8.1 and a fatal `TypeError` in PHP 9.0:
`Deprecated: Passing null to parameter #1 ($string) of type string is deprecated`
Common culprits include: `strlen( null )`, `trim( null )`, `str_replace( 'a', 'b', null )`, `explode( ',', null )`.

**Remediation:** Cast the value to string or provide a default fallback:
```php
// Deprecated:
$len = strlen( $maybe_null_value );

// Compliant:
$len = strlen( (string) $maybe_null_value );
// Or:
$len = strlen( $maybe_null_value ?? '' );
```

---

### B. Return Types on Internal Interface Methods
**Issue:** Classes implementing PHP built-in interfaces (`ArrayAccess`, `Iterator`, `IteratorAggregate`, `Countable`, `JsonSerializable`) must specify return types matching PHP's native signatures, or PHP 8.1 will emit a deprecation notice:
`Deprecated: Return type of My_Class::count() should either be compatible with Countable::count(): int, or the #[\ReturnTypeWillChange] attribute should be used to temporarily suppress the notice`

**Remediation:**
1. **Preferred (when runtime floor allows):** Add the explicit return type:
   ```php
   public function count(): int {
       return count( $this->items );
   }
   ```
2. **Backward-Compatible Alternative:** Apply the `#[\ReturnTypeWillChange]` attribute:
   ```php
   #[\ReturnTypeWillChange]
   public function count() {
       return count( $this->items );
   }
   ```

---

### C. Deprecated `strftime()` and `gmstrftime()`
**Issue:** `strftime()` and `gmstrftime()` are deprecated in PHP 8.1 due to system-dependent locale inconsistencies.

**Remediation:** Replace with `date()`, `gmdate()`, or `wp_date()` in WordPress:
```php
// Deprecated:
$date_str = strftime( '%Y-%m-%d', $timestamp );

// Compliant:
$date_str = gmdate( 'Y-m-d', $timestamp );
// Or in WordPress:
$date_str = wp_date( 'Y-m-d', $timestamp );
```

---

### D. Deprecated `auto_detect_line_endings` INI Directive
**Issue:** Legacy CSV or text file importers often invoke `ini_set( 'auto_detect_line_endings', true );`. This directive is deprecated in PHP 8.1 and emits an `E_DEPRECATED` notice.

**Remediation:** Safely remove the `ini_set()` call and normalize line breaks using string or stream operations:
```php
// Legacy:
ini_set( 'auto_detect_line_endings', true );

// Compliant:
$content = str_replace( [ "\r\n", "\r" ], "\n", $raw_content );
```

---

### E. Restricting `$GLOBALS` Modification by Reference
**Issue:** In PHP 8.1+, modifying `$GLOBALS` through reference assignment (e.g. `$GLOBALS = [...]` or `$ref = &$GLOBALS`) triggers a fatal compile error.

**Remediation:** Always modify individual keys within `$GLOBALS` directly:
```php
// Compliant:
$GLOBALS['my_key'] = $value;
```

---

## 3. PHP 8.2 Deprecations & Breaking Changes

### A. Dynamic Properties Deprecation
**Issue:** Assigning values to undeclared class properties triggers a deprecation notice in PHP 8.2 and becomes a fatal `Error` in PHP 9.0:
`Creation of dynamic property ClassName::$custom_property is deprecated`

**Remediation Options:**
1. **Declare Class Properties (Preferred):** Explicitly declare the property with an appropriate type and default value:
   ```php
   class My_Plugin_Admin {
       /**
        * Plugin slug.
        *
        * @var string
        */
       protected string $plugin_slug = '';
   }
   ```
2. **Apply `#[AllowDynamicProperties]` Attribute:** When the class is designed for dynamic property extension (e.g., data transfer objects, registry containers) and modifying all call sites is impractical:
   ```php
   #[\AllowDynamicProperties]
   class My_Legacy_Data_Container {
       // Dynamic property assignments remain valid without notices.
   }
   ```
*Note: `stdClass` and classes implementing `__set()` / `__get()` magic methods are exempt from this deprecation notice.*

---

### B. Deprecated `${var}` String Interpolation
**Issue:** The `${var}` syntax inside double-quoted strings and heredocs is deprecated in PHP 8.2:
```php
// Deprecated:
$message = "Hello ${name}!";
$key     = "cache_${post_id}_data";
```

**Remediation:** Replace with standard braces `{$var}` or plain `$var`:
```php
// Compliant:
$message = "Hello {$name}!";
$key     = "cache_{$post_id}_data";
```

---

### C. Deprecated `utf8_encode()` and `utf8_decode()`
**Issue:** The functions `utf8_encode()` and `utf8_decode()` assume ISO-8859-1 encoding and produce incorrect conversions for other single-byte encodings. Both functions are formally deprecated in PHP 8.2.

**Remediation:** Replace with `mb_convert_encoding()` or `iconv()`:
```php
// Legacy:
$utf8_str = utf8_encode( $raw_data );
$iso_str  = utf8_decode( $utf8_data );

// Compliant:
$utf8_str = mb_convert_encoding( $raw_data, 'UTF-8', 'ISO-8859-1' );
$iso_str  = mb_convert_encoding( $utf8_data, 'ISO-8859-1', 'UTF-8' );
```
*Note: In WordPress environments, `mb_convert_encoding()` is bundled in the required `mbstring` extension.*

---

## 4. PHP 8.3 Deprecations & Breaking Changes

### A. Deprecated `get_class()` and `get_parent_class()` Without Arguments
**Issue:** Calling `get_class()` or `get_parent_class()` without passing an object parameter inside a class context is deprecated in PHP 8.3.

**Remediation:** Pass `$this` or use `static::class` / `self::class`:
```php
// Legacy:
$class_name = get_class();

// Compliant:
$class_name = static::class;
// Or:
$class_name = get_class( $this );
```

---

### B. Stricter `unserialize()` Error Handling
**Issue:** In PHP 8.3, `unserialize()` emits an `E_WARNING` instead of an `E_NOTICE` when passed malformed or un-parsable data.

**Remediation:** Always ensure `is_serialized()` check guards untrusted input or catch serialization warnings:
```php
if ( is_serialized( $raw_data ) ) {
    $data = maybe_unserialize( $raw_data );
}
```

---

### C. Typed Class Constants & Override Attribute
- Class constants can now carry types: `public const string SLUG = 'my-slug';`
- The `#[\Override]` attribute can be added to methods overriding parent or interface declarations to ensure compile-time verification.

---

## 5. PHP 8.4 Deprecations & Breaking Changes

### A. Implicitly Nullable Parameter Types
**Issue:** Declaring a parameter with a default value of `null` without declaring the type as nullable emits a deprecation notice in PHP 8.4:
```php
// Deprecated in PHP 8.4:
function process_post( WP_Post $post = null ) {}
function set_title( string $title = null ) {}
```

**Remediation:** Explicitly declare the type as nullable using `?` or union `|null`:
```php
// Compliant:
function process_post( ?WP_Post $post = null ) {}
function set_title( ?string $title = null ) {}
// Or:
function set_title( string|null $title = null ) {}
```

---

### B. Deprecated `CURLOPT_BINARYTRANSFER`
**Issue:** Passing `CURLOPT_BINARYTRANSFER` to `curl_setopt()` is deprecated in PHP 8.4 as it has been a no-op since cURL 7.20.

**Remediation:** Remove `curl_setopt( $ch, CURLOPT_BINARYTRANSFER, 1 );` calls from custom HTTP clients.

---

### C. Modern Built-In Array Inspection Functions
PHP 8.4 introduces native array search utilities:
- `array_find( array $array, callable $callback )`
- `array_find_key( array $array, callable $callback )`
- `array_any( array $array, callable $callback )`
- `array_all( array $array, callable $callback )`

Where plugins have custom helper functions emulating these operations, verify there is no naming collision with native PHP functions.

---

## 6. PHP 8.5 Forward Compatibility

### A. Forward Compatibility Mindset
- Treat PHP 8.5 in continuous integration as an early warning detection system.
- Avoid pinning dependencies to strict `<8.5` constraints unless an unresolvable fatal error exists.
- Report any upstream library incompatibilities to the maintainer or track in repository issue notes.
