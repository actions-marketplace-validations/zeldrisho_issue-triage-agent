import { describe, it } from "vite-plus/test";
import { RuleTester } from "vite-plus/lint/plugins-dev";
import { noObjectParametersRule } from "../tools/oxlint/anti-slop/rules/no-object-parameters.js";
import { noKnownValueWideningRule } from "../tools/oxlint/anti-slop/rules/no-known-value-widening.js";
import { noUnsafeDictionaryTypeRule } from "../tools/oxlint/anti-slop/rules/no-unsafe-dictionary-type.js";
import { noUnknownReturnsRule } from "../tools/oxlint/anti-slop/rules/no-unknown-returns.js";
import { preferEffectMatchRule } from "../tools/oxlint/anti-slop/effect/rules/prefer-effect-match.js";

RuleTester.describe = describe;

RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("object-parameters", noObjectParametersRule, {
  valid: ["type Id<T> = T; function f(x: Id<string>) {}"],
  invalid: [
    {
      code: "type Id<T> = T; function f(x: Id<Id<object>>) {}",
      errors: [{ messageId: "objectParameter" }],
    },
    {
      code: "function outer<T>() { function inner() { type T = object; function f(x: T) {} } }",
      errors: [{ messageId: "objectParameter" }],
    },
    {
      code: "type T = object; const x = class T {}; function f(x: T) {}",
      errors: [{ messageId: "objectParameter" }],
    },
  ],
});

tester.run("unsafe-dictionary", noUnsafeDictionaryTypeRule, {
  valid: [
    "interface Value {} function f<Value>() { class C { [key: string]: Value } }",
    "type Inner = Value; type Value = string; type Outer<Value> = Inner | Value[]; class C { [key: string]: Outer<unknown> }",
    "type Second<A,B> = B | A[]; type Swap<A,B> = Second<B,A>; class C { [key: string]: Swap<{id:string},unknown> }",
  ],
  invalid: [
    {
      code: "type Bag<T = unknown> = Record<string, T>; let bag: Bag;",
      errors: [{ messageId: "unsafeDictionary" }],
    },
    {
      code: "type Choose<T> = T extends (string extends infer Record ? Record : never) ? Record<string, unknown> : never;",
      errors: [{ messageId: "unsafeDictionary" }],
    },
  ],
});

tester.run("unknown-returns", noUnknownReturnsRule, {
  valid: ["interface Promise<T> {} function f(): Promise<unknown> { throw 1; }"],
  invalid: [
    {
      code: "function f(): Promise<unknown> { throw 1; }",
      errors: [{ messageId: "unknownReturn" }],
    },
  ],
});

tester.run("known-value-widening", noKnownValueWideningRule, {
  valid: [
    "function f(input: unknown) { const { value } = { value: input }; const broad: unknown = value; }",
  ],
  invalid: [{ code: "const value: unknown = 1;", errors: [{ messageId: "widening" }] }],
});

tester.run("prefer-match", preferEffectMatchRule, {
  valid: ["const x = a ? b : c;"],
  invalid: [
    {
      code: "const x = a ? (b === 1 ? 1 : b === 2 ? 2 : 3) : 0;",
      errors: [{ messageId: "preferMatch" }],
    },
  ],
});
