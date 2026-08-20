const filenameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function sortByFilename<T extends { name: string }>(items: readonly T[]) {
  return [...items].sort((left, right) => filenameCollator.compare(left.name, right.name));
}

export function appendSorted<T extends { name: string }>(
  current: readonly T[],
  incoming: readonly T[],
) {
  return [...current, ...sortByFilename(incoming)];
}
