# Trazo

## Documentation Standards

All code documentation must be written in **English** and follow the **standard JSDoc syntax**.

### JSDoc requirements

* Use standard JSDoc comments (`/** ... */`) for documentation.
* Document all exported/public:

  * functions
  * classes
  * methods
  * interfaces
  * types
  * enums
  * significant modules or public APIs
* Use `@param` for parameters when their purpose or constraints are not completely obvious.
* Use `@returns` for return values when the behavior or meaning is not completely obvious from the type signature.
* Use `@throws` to document errors that callers may reasonably need to handle.
* Use `@template`, `@example`, `@deprecated`, `@see`, and other JSDoc tags when they provide meaningful information.
* Document important business rules, invariants, side effects, constraints, assumptions, and non-obvious behavior.
* For public APIs, document the behavioral contract rather than merely describing the implementation.

### Documentation quality

* Prefer documenting **why, constraints, and behavior** over restating what the code obviously does.
* Do not add documentation that simply repeats the function name, parameter name, or TypeScript type.
* Do not document trivial private/helper functions when their behavior is self-evident.
* Do not add comments to obvious code merely to increase documentation coverage.
* Keep documentation concise and accurate.
* Never document behavior that the code does not actually implement.
* Update existing JSDoc when changing the behavior of documented code.
* Remove or correct stale documentation when modifying existing code.

### TypeScript

* Treat TypeScript types as the source of truth for type information.
* Do not duplicate complete type definitions inside JSDoc.
* Use JSDoc to explain semantics, constraints, business meaning, or behavior that cannot be expressed by the type system.
* Document public interfaces and types when their purpose or fields have domain-specific meaning.

### Examples

Prefer:

```ts
/**
 * Resolves the tenant associated with the authenticated request.
 *
 * The tenant must exist and be active for the request to proceed.
 *
 * @param context - The authenticated request context.
 * @returns The active tenant associated with the request.
 * @throws {TenantNotFoundError} If the tenant cannot be resolved.
 * @throws {TenantInactiveError} If the tenant is disabled.
 */
```

Avoid:

```ts
/**
 * Resolves a tenant.
 *
 * @param context - The context.
 * @returns The tenant.
 */
```

And avoid documenting self-explanatory code:

```ts
/**
 * Adds two numbers.
 *
 * @param a - First number.
 * @param b - Second number.
 * @returns The sum.
 */
function add(a: number, b: number): number {
  return a + b;
}
```

### Completion criteria

When modifying or creating code:

1. Review the affected public API.
2. Add or update JSDoc where required.
3. Ensure all documentation is written in English.
4. Verify that documentation matches the actual implementation.
5. Do not modify application behavior solely for documentation purposes.
