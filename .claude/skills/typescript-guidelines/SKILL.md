---
name: typescript-guidelines
description: TypeScript patterns for type-safe, maintainable code. Use when writing, reviewing, or refactoring any TypeScript in this project — especially around typing external/unknown data, modelling state, narrowing, deriving types from values, or choosing between enum/union/as const. Apply these whenever you reach for `any`, `as`, `enum`, or hand-write a type that could be inferred.
license: MIT
---

# TypeScript Guidelines

Patterns for type-safe, maintainable TypeScript, adapted from [typescript-tips-everyone-should-know](https://github.com/AllThingsSmitty/typescript-tips-everyone-should-know).

**Project constraint:** This codebase runs TypeScript natively via Node's type stripping — **erasable syntax only**. `enum`, `namespace`, and constructor parameter properties are not just discouraged, they will not run. Several guidelines below align with that; they're marked.

**Tradeoff:** These bias toward stronger types and runtime validation over terseness. For throwaway scripts, use judgment.

## 1. Prefer `unknown` over `any`

`any` switches off the type checker; `unknown` keeps it on and forces you to narrow before use. Reach for `unknown` at boundaries where you don't yet know the shape — parsed JSON, caught errors, dynamic input.

```ts
function parse(data: unknown) {
  if (typeof data === "string") return data.toUpperCase();
}
```

If you find yourself writing `any` to silence an error, that's a signal to narrow or validate instead.

## 2. Let inference do the work

Annotating what the compiler can already see adds noise and a second thing to keep in sync. Annotate function parameters and public API boundaries; let locals and return types infer.

```ts
const name = "Ada"; // not: const name: string = "Ada"
```

## 3. Prefer `satisfies` over `as`

`as` is an assertion — it tells the compiler to trust you, discarding its own checks. `satisfies` validates the value against a type **without widening it**, so you keep the precise inferred type *and* get checked.

```ts
const routes = {
  home: "/",
  about: "/about",
} satisfies Record<string, string>;
// routes.home is "/" (literal), and a typo'd value is still caught
```

## 4. Derive types from values

When a type and a runtime value must agree, generate the type from the value so they can't drift apart.

```ts
const roles = ["admin", "user", "guest"] as const;
type Role = (typeof roles)[number]; // "admin" | "user" | "guest"
```

## 5. Model impossible states with discriminated unions

A single object with optional fields lets contradictory states compile (`loading: true` *and* a populated `data`). A discriminated union makes only valid combinations representable.

```ts
type State =
  | { status: "loading" }
  | { status: "success"; data: User }
  | { status: "error"; error: Error };
```

## 6. Make unions exhaustive with `never`

Assigning the narrowed value to `never` in the default case turns "you forgot a variant" into a compile error rather than a silent runtime fall-through. Pairs naturally with guideline 5.

```ts
function render(state: State) {
  switch (state.status) {
    case "loading": return "…";
    case "success": return state.data.name;
    case "error": return state.error.message;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
```

## 7. Use `as const` for configuration and constants

Without it, `{ mode: "dark" }` widens `mode` to `string`. `as const` preserves the literal, which feeds guidelines 4 and 6.

```ts
const theme = { mode: "dark" } as const; // mode is "dark", not string
```

## 8. Write type predicates for reusable narrowing

A function returning `value is T` connects a runtime check to compile-time narrowing, so callers get type safety without repeating the check.

```ts
function isUser(value: unknown): value is User {
  return typeof value === "object" && value !== null && "id" in value;
}
```

## 9. Build new types from existing ones

Don't hand-maintain parallel type definitions. Derive with `Pick`, `Omit`, `Partial`, `Required`, and indexed access so changes to the source type propagate.

```ts
type UserPreview = Pick<User, "id" | "name">;
```

## 10. Validate external data at runtime

Types vanish at compile time. Data crossing a runtime boundary — HTTP responses, env vars, DB rows, file contents — is `unknown` no matter what the signature claims. Validate it; don't assert it.

```ts
// Lies — compiles fine, blows up later if the shape is wrong:
const user = (await response.json()) as User;

// Honest — parse and validate the actual data:
const user = UserSchema.parse(await response.json());
```

This is the most important guideline. `as User` on `response.json()` is the classic source of "but it type-checked" bugs.

## 11. Avoid `enum` — use literal unions with `as const`

Enums generate runtime code, don't serialize cleanly, and have surprising semantics. A `const` array or union of string literals is simpler and JSON-friendly.

**Required here:** type stripping forbids `enum` outright — this is non-negotiable in this project.

```ts
const roles = ["admin", "user"] as const;
type Role = (typeof roles)[number];
```

## 12. Design generics that infer

A generic API that infers its type parameters from arguments is far nicer to call than one requiring explicit `<T>`. Let the argument carry the type.

```ts
getData(userSchema); // infers the result type — not getData<User>()
```

## 13. Keep strict compiler options on

Strictness catches whole classes of bugs for free. Beyond `strict: true`, `noUncheckedIndexedAccess` (array/record access yields `T | undefined`) and `exactOptionalPropertyTypes` close common gaps. Don't loosen these to make an error go away — fix the cause.

## 14. Reach for template literal types where they fit

For string patterns — routes, event names, keys — template literal types catch malformed strings at compile time.

```ts
type Route = `/api/${string}`;
```

## 15. Type-safe is not runtime-safe

TypeScript checks shapes at compile time. It does not validate input, prevent runtime errors, or guarantee good design. When code compiles but could still fail on real data, that's guideline 10's job — not the type system's. Treat green compiles as necessary, not sufficient.
