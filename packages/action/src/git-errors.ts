/** True when git's stderr says the path is simply absent at the revision. */
export function isMissingAtRevision(stderr: string): boolean {
  return /does not exist|exists on disk, but not in/.test(stderr);
}
