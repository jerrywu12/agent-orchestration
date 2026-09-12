import { createHash } from "node:crypto";
import { basename, extname } from "node:path";
import { Worker } from "node:worker_threads";

export const DOCUMENT_LIMITS = Object.freeze({
  maxFileBytes: 10 * 1024 * 1024,
  maxTextChars: 100000,
  maxPdfPages: 200,
  maxArchiveEntries: 1000,
  maxArchiveBytes: 32 * 1024 * 1024,
  maxArchiveEntryBytes: 16 * 1024 * 1024,
  timeoutMs: 20000,
  maxConcurrent: 2,
  workerHeapMb: 128,
});

const messages = Object.freeze({
  unsupported_type: "Choose a TXT, DOC, DOCX or PDF document.",
  invalid_document:
    "The document is malformed, has an invalid encoding, or contains unsupported content. Export a plain text copy and retry.",
  encrypted_document:
    "Encrypted or password-protected documents are unsupported. Save an unencrypted copy and retry.",
  no_text:
    "No readable text was found. Scanned documents need OCR first; upload a text-based document.",
  document_limit:
    "The document exceeds a file, extracted text, page, archive or memory limit. Split it into smaller documents.",
  processing_timeout:
    "Document processing exceeded its time limit. Split the document or export plain text and retry.",
  processing_busy:
    "Two documents are already processing. Wait for one to finish and retry.",
  processing_cancelled: "Document processing was cancelled.",
  processing_failed:
    "Document processing failed. Export a plain text copy and retry.",
});

export class DocumentProcessingError extends Error {
  constructor(code) {
    const safeCode = Object.hasOwn(messages, code) ? code : "processing_failed";
    super(messages[safeCode]);
    this.name = "DocumentProcessingError";
    this.code = safeCode;
  }
}

const mediaTypes = Object.freeze({
  ".txt": "text/plain",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
});
const oleMagic = Buffer.from("d0cf11e0a1b11ae1", "hex");
let active = 0;

function safeLimits(requested = {}) {
  return Object.fromEntries(
    Object.entries(DOCUMENT_LIMITS).map(([key, max]) => [
      key,
      Number.isSafeInteger(requested?.[key]) && requested[key] > 0
        ? Math.min(requested[key], max)
        : max,
    ]),
  );
}

/** Local byte-only extraction. Options may lower limits and provide an AbortSignal.
 * No queue: excess work rejects immediately. Original bytes are never detached.
 * Worker heap limits do not include external buffers; separate byte/archive caps apply.
 */
export async function processDocument(input, options = {}) {
  const limits = safeLimits(options.limits);
  if (typeof input?.name !== "string" || !Buffer.isBuffer(input?.bytes))
    throw new DocumentProcessingError("invalid_document");
  const name = basename(input.name.replaceAll("\\", "/"))
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
  if (!name || name.length > 200)
    throw new DocumentProcessingError("invalid_document");
  const kind = extname(name).toLowerCase();
  if (!Object.hasOwn(mediaTypes, kind))
    throw new DocumentProcessingError("unsupported_type");
  const bytes = input.bytes;
  if (bytes.length > limits.maxFileBytes)
    throw new DocumentProcessingError("document_limit");
  if (bytes.length === 0) throw new DocumentProcessingError("no_text");
  const ole = bytes.subarray(0, 8).equals(oleMagic);
  const pdf = bytes.subarray(0, 5).equals(Buffer.from("%PDF-"));
  const zip = bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50;
  if (
    (kind === ".pdf" && !pdf) ||
    (kind === ".doc" && !ole) ||
    (kind === ".docx" && !zip && !ole) ||
    (kind === ".txt" && (ole || pdf || zip))
  )
    throw new DocumentProcessingError("invalid_document");
  if (options.signal?.aborted)
    throw new DocumentProcessingError("processing_cancelled");
  if (active >= limits.maxConcurrent)
    throw new DocumentProcessingError("processing_busy");
  active++;
  let worker, sha256;
  const size = bytes.length;
  try {
    const copy = Uint8Array.from(bytes);
    sha256 = createHash("sha256").update(copy).digest("hex");
    worker = new Worker(new URL("./document-worker.mjs", import.meta.url), {
      workerData: { bytes: copy, kind, limits },
      transferList: [copy.buffer],
      resourceLimits: {
        maxOldGenerationSizeMb: limits.workerHeapMb,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
      // Dependency warnings/errors must never print document text or private paths.
      stdout: true,
      stderr: true,
    });
  } catch {
    active--;
    throw new DocumentProcessingError("processing_failed");
  }
  worker.stdout.resume();
  worker.stderr.resume();
  const extracted = await new Promise((resolve, reject) => {
    let settled = false;
    const finish = async (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      try {
        await worker.terminate();
      } catch {
        /* The worker may already have exited. */
      }
      active--;
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () =>
      finish(new DocumentProcessingError("processing_cancelled"));
    const timer = setTimeout(
      () => finish(new DocumentProcessingError("processing_timeout")),
      limits.timeoutMs,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.once("message", (message) => {
      if (message?.error)
        return finish(new DocumentProcessingError(message.error));
      if (
        typeof message?.text !== "string" ||
        !message.text.trim() ||
        message.text.length > limits.maxTextChars ||
        !Array.isArray(message.warnings) ||
        message.warnings.some(
          (warning) => typeof warning !== "string" || warning.length > 250,
        )
      )
        return finish(new DocumentProcessingError("processing_failed"));
      finish(null, message);
    });
    worker.once("error", (error) =>
      finish(
        new DocumentProcessingError(
          error.code === "ERR_WORKER_OUT_OF_MEMORY"
            ? "document_limit"
            : "processing_failed",
        ),
      ),
    );
    worker.once("exit", () =>
      finish(new DocumentProcessingError("processing_failed")),
    );
    if (options.signal?.aborted) abort();
  });
  return {
    name,
    size,
    sha256,
    mediaType: mediaTypes[kind],
    text: extracted.text,
    warnings: extracted.warnings,
    ...(extracted.pageCount === undefined
      ? {}
      : { pageCount: extracted.pageCount }),
  };
}
