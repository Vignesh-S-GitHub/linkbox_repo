// Local mock storage lives in one isolate. Serialize reservation and duplicate checks there.
// This does not claim to provide a distributed lock for live deployment.
let tail: Promise<unknown> = Promise.resolve();
export function serializeSubmission<T>(operation: () => Promise<T>): Promise<T> {
  const next = tail.then(operation,operation);
  tail = next.catch(() => undefined);
  return next;
}
