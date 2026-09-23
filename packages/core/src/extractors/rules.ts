/**
 * User-defined mapping from something an extractor recognises (a CloudFormation resource type, an
 * Amplify service, an image name...) to the kind of component it is drawn as, or {@link IGNORE}.
 * Keys may use `*` as a wildcard, for example `AWS::EC2::*`.
 */
export type KindRules = Readonly<Record<string, string>>;

/** Rule value that leaves whatever matches the key out of the diagram. */
export const IGNORE = "ignore";

/** What the caller gives an extractor besides the file. */
export interface ExtractOptions {
  /** The user's rules for this extractor. They take priority over the built-in classification. */
  rules?: KindRules | undefined;
}

const compiled = new WeakMap<KindRules, Array<{ pattern: RegExp; specificity: number; kind: string }>>();

const escapeRegex = (text: string) => text.replace(/[.*+?^$|()[\]{}\\]/g, "\\$&");

function compile(rules: KindRules) {
  let entries = compiled.get(rules);
  if (!entries) {
    entries = Object.entries(rules).map(([key, kind]) => ({
      pattern: new RegExp("^" + key.split("*").map(escapeRegex).join(".*") + "$", "i"),
      specificity: key.replaceAll("*", "").length,
      kind,
    }));
    compiled.set(rules, entries);
  }
  return entries;
}

/**
 * Looks a key up in the user's rules. Matching ignores case. When several rules match, the one with
 * the most literal characters wins, so `AWS::S3::Bucket` beats `AWS::S3::*`, which beats `*`.
 *
 * @returns The kind to draw, {@link IGNORE}, or undefined when no rule applies.
 */
export function ruleFor(rules: KindRules | undefined, key: string | undefined): string | undefined {
  if (!rules || key === undefined) return undefined;
  let best: { specificity: number; kind: string } | undefined;
  for (const entry of compile(rules)) {
    if (entry.pattern.test(key) && (!best || entry.specificity > best.specificity)) best = entry;
  }
  return best?.kind;
}
