# Targeted Value-Add Modernization Guardrails

A core tenet of the Fueled and 10up open-source engineering philosophy is:
> **"Avoid unnecessary refactoring solely to adopt newer PHP syntax. Focus on compatibility, test coverage, and stability."**

This reference provides strict guardrails distinguishing high-value modernizations from cosmetic churn.

---

## 1. The Three Tiers of Code Modification

| Tier | Category | Policy | Examples |
|---|---|---|---|
| **Tier 1** | **Mandatory Compatibility & Deprecations** | **Required** | Adding `#[AllowDynamicProperties]` or declaring class properties; replacing `utf8_encode()`; fixing `${var}` strings; updating CI matrices. |
| **Tier 2** | **Targeted High-Value Modernizations** | **Selective & Surgical** | Marking immutable DTO properties as `readonly`; pruning dead `<8.2` version polyfills; modernizing native return types on strictly sealed internal classes. |
| **Tier 3** | **Cosmetic Syntax Churn** | **FORBIDDEN** | Converting legacy switch statements to match expressions without need; rewriting standard constructors to constructor promotion across stable classes; bulk typing parameters on public API hooks. |

---

## 2. Forbidden Refactoring Patterns (Cosmetic Churn)

Do **NOT** execute the following changes in PHP support upgrade pull requests:

### ❌ 1. Bulk Parameter Typing on Public Hooks or API Classes
Adding parameter type declarations to existing public methods or WordPress action/filter callbacks introduces breaking changes for downstream extenders:
```php
// DO NOT DO THIS:
// Changing public callback:
- public function filter_post_title( $title, $id )
+ public function filter_post_title( string $title, int $id ): string
```
*Rationale:* If a third-party plugin or filter hook passes an integer or null, this causes an uncaught fatal `TypeError` at runtime.

### ❌ 2. Wholesale Constructor Property Promotion Rewrites
Rewriting working class constructors solely to adopt PHP 8.0 constructor property promotion bloats PR diffs:
```php
// DO NOT DO THIS:
- public function __construct( $api_key, $endpoint ) {
-     $this->api_key  = $api_key;
-     $this->endpoint = $endpoint;
- }
+ public function __construct(
+     private string $api_key,
+     private string $endpoint,
+ ) {}
```
*Rationale:* Obscures actual bug fixes and causes unnecessary review friction for maintainers.

### ❌ 3. Blind Replacement of `switch` with `match`
Replacing stable `switch` statements with `match` expressions across legacy files.
*Rationale:* `match` uses strict identity comparison (`===`) whereas `switch` uses loose comparison (`==`). Blind conversions frequently introduce subtle bugs when comparing numbers, strings, or booleans.

---

## 3. Allowed and Recommended Targeted Modernizations

The following modernizations add concrete enterprise value when applied surgically:

### ✅ 1. Marking Immutable Value Objects as `readonly`
For newly introduced or strictly self-contained internal data objects (such as API response value objects or event payloads):
```php
final class Webhook_Payload {
    public function __construct(
        public readonly string $event_id,
        public readonly int $timestamp,
        public readonly array $data
    ) {}
}
```

### ✅ 2. Eliminating Deprecated Dynamic Properties
Either declare the property explicitly:
```php
class Safe_Redirect_Admin {
    /**
     * Admin notice message.
     *
     * @var string
     */
    protected string $notice = '';
}
```
Or mark the class with `#[AllowDynamicProperties]` if dynamic properties are intentionally consumed by consumers or filters:
```php
#[\AllowDynamicProperties]
class Legacy_Data_Store {
    // Preserves dynamic property assignments without deprecation notices.
}
```

### ✅ 3. Pruning Defunct Polyfill Blocks
Removing standalone polyfills for `str_contains()`, `str_starts_with()`, and `str_ends_with()` that were bundled prior to PHP 8.0.
