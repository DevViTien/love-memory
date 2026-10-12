function parse(version: string): Readonly<{ core: readonly number[]; prerelease: string | null }> {
  const [core = "", ...rest] = version.split("+")[0]?.split("-") ?? [];
  return {
    core: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
    prerelease: rest.length > 0 ? rest.join("-") : null,
  };
}

/**
 * Semantic Versioning precedence, simplified for template versions: numeric `major.minor.patch`,
 * then a release above its prereleases, then prereleases by plain text. Negative when `left` is
 * lower.
 */
export function compareSemanticVersions(left: string, right: string): number {
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}
