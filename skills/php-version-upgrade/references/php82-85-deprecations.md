# PHP 8.2–8.5 Deprecations and Incompatibilities Reference

This document provides a comprehensive technical guide to breaking changes, deprecation notices, and migration patterns for PHP 8.2 through PHP 8.5 within the WordPress, Fueled, and 10up ecosystem.

---

## 1. PHP 8.2 Deprecations & Breaking Changes

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

### D. Deprecated `auto_detect_line_endings` INI Directive
**Issue:** Legacy CSV or text file importers often invoke `ini_set( 'auto_detect_line_endings', true );`. This directive is deprecated and ignored in modern PHP.

**Remediation:** Safely remove the `ini_set()` call and normalize line breaks using string or stream operations:
```php
// Legacy:
ini_set( 'auto_detect_line_endings', true );

// Compliant:
$content = str_replace( [ "\r\n", "\r" ], "\n", $raw_content );
```

---

## 2. PHP 8.3 Deprecations & Breaking Changes

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

## 3. PHP 8.4 Deprecations & Breaking Changes

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

## 4. PHP 8.5 Forward Compatibility

### A. Forward Compatibility Mindset
- Treat PHP 8.5 in continuous integration as an early warning detection system.
- Avoid pinning dependencies to strict `<8.5` constraints unless an unresolvable fatal error exists.
- Report any upstream library incompatibilities to the maintainer or track in repository issue notes.
