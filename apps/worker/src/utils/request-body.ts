import { ApiProblem } from "./magnet";

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const limit = 12 * 1024;
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ApiProblem(415,"invalid_content_type","Send this request as JSON.");
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw new ApiProblem(413,"request_too_large","This request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiProblem(400,"invalid_json","Enter a valid request.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ApiProblem(413,"request_too_large","This request is too large."); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid JSON object");
    return value as Record<string,unknown>;
  } catch { throw new ApiProblem(400,"invalid_json","Enter a valid JSON request."); }
}
