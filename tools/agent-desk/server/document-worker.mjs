import { parentPort, workerData } from "node:worker_threads";
import { crc32, inflateRawSync } from "node:zlib";
import { createRequire } from "node:module";
import { DocumentProcessingError } from "./document-processor.mjs";

const fail = (code = "invalid_document") => {
  throw new DocumentProcessingError(code);
};
const check = (condition, code) => {
  if (!condition) fail(code);
};
const forbiddenControls = /[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f]/;

function decode(bytes) {
  let encoding = "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    fail();
  }
}

function finishText(text, limits) {
  check(typeof text === "string");
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\f/g, "\n").trim();
  check(normalized.length <= limits.maxTextChars, "document_limit");
  check(!forbiddenControls.test(normalized));
  check(normalized.length > 0, "no_text");
  return normalized;
}

// No extraction to disk. Check central and local records, then independently
// inflate every entry with an actual output bound before handing bytes to Word.
function validateDocx(bytes, limits) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  check(end >= 0);
  check(bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0);
  const count = bytes.readUInt16LE(end + 10);
  check(count > 0 && count === bytes.readUInt16LE(end + 8) && count !== 0xffff);
  check(count <= limits.maxArchiveEntries, "document_limit");
  const size = bytes.readUInt32LE(end + 12),
    start = bytes.readUInt32LE(end + 16);
  check(start + size === end);
  const names = new Set(),
    spans = [],
    xml = new Map();
  const { SaxesParser } = createRequire(import.meta.resolve("word-extractor"))(
    "saxes",
  );
  let ignoredHyperlinks = false;
  let pos = start,
    expanded = 0;
  for (let i = 0; i < count; i++) {
    check(pos + 46 <= end && bytes.readUInt32LE(pos) === 0x02014b50);
    const flags = bytes.readUInt16LE(pos + 8),
      method = bytes.readUInt16LE(pos + 10);
    check(!(flags & 1), "encrypted_document");
    check((flags & ~0x080e) === 0 && [0, 8].includes(method));
    const checksum = bytes.readUInt32LE(pos + 16),
      compressed = bytes.readUInt32LE(pos + 20),
      unpacked = bytes.readUInt32LE(pos + 24);
    const nameLength = bytes.readUInt16LE(pos + 28),
      extraLength = bytes.readUInt16LE(pos + 30),
      commentLength = bytes.readUInt16LE(pos + 32);
    const local = bytes.readUInt32LE(pos + 42);
    check(
      pos + 46 + nameLength + extraLength + commentLength <= end &&
        bytes.readUInt16LE(pos + 34) === 0,
    );
    const rawName = bytes.subarray(pos + 46, pos + 46 + nameLength),
      name = decode(rawName);
    check(
      name &&
        !name.startsWith("/") &&
        !/[\\:\u0000-\u001f\u007f]/.test(name) &&
        !name
          .split("/")
          .some((part) =>
            ["..", ".", "__proto__", "constructor", "prototype"].includes(part),
          ),
    );
    check(!names.has(name.toLowerCase()));
    names.add(name.toLowerCase());
    check(!/vbaproject|activex|embeddings\//i.test(name));
    check(((bytes.readUInt32LE(pos + 38) >>> 16) & 0xf000) !== 0xa000);
    let extra = pos + 46 + nameLength;
    while (extra < pos + 46 + nameLength + extraLength) {
      check(
        extra + 4 <= pos + 46 + nameLength + extraLength &&
          bytes.readUInt16LE(extra) !== 1,
      );
      extra += 4 + bytes.readUInt16LE(extra + 2);
    }
    check(extra === pos + 46 + nameLength + extraLength);
    expanded += unpacked;
    check(
      unpacked <= limits.maxArchiveEntryBytes &&
        expanded <= limits.maxArchiveBytes,
      "document_limit",
    );
    check(local + 30 <= start && bytes.readUInt32LE(local) === 0x04034b50);
    const localName = bytes.readUInt16LE(local + 26),
      localExtra = bytes.readUInt16LE(local + 28);
    check(
      bytes.readUInt16LE(local + 6) === flags &&
        bytes.readUInt16LE(local + 8) === method &&
        localName === nameLength,
    );
    const dataStart = local + 30 + localName + localExtra;
    let dataEnd = dataStart + compressed;
    check(
      dataEnd <= start &&
        bytes.subarray(local + 30, local + 30 + localName).equals(rawName),
    );
    if (flags & 8) {
      if (dataEnd + 4 <= start && bytes.readUInt32LE(dataEnd) === 0x08074b50)
        dataEnd += 4;
      check(
        dataEnd + 12 <= start &&
          bytes.readUInt32LE(dataEnd) === checksum &&
          bytes.readUInt32LE(dataEnd + 4) === compressed &&
          bytes.readUInt32LE(dataEnd + 8) === unpacked,
      );
      dataEnd += 12;
    } else
      check(
        bytes.readUInt32LE(local + 14) === checksum &&
          bytes.readUInt32LE(local + 18) === compressed &&
          bytes.readUInt32LE(local + 22) === unpacked,
      );
    spans.push([local, dataEnd]);
    let data;
    try {
      const packed = bytes.subarray(dataStart, dataStart + compressed);
      data =
        method === 0
          ? packed
          : inflateRawSync(packed, {
              maxOutputLength: Math.min(
                limits.maxArchiveEntryBytes,
                limits.maxArchiveBytes,
              ),
            });
    } catch (error) {
      fail(
        error.code === "ERR_BUFFER_TOO_LARGE"
          ? "document_limit"
          : "invalid_document",
      );
    }
    check(data.length === unpacked && crc32(data) === checksum);
    if (/\.(?:xml|rels)$/i.test(name)) {
      const text = decode(data);
      check(!/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text));
      // Parse attributes semantically, including XML character references. URLs
      // in plain document text remain text; linked content is never resolved.
      const parser = new SaxesParser({ xmlns: true });
      parser.on("error", () => fail());
      parser.on("opentag", (node) => {
        check(node.local !== "altChunk");
        const contentType = node.attributes.ContentType?.value;
        check(
          !contentType || !/macroEnabled|vbaProject|activeX/i.test(contentType),
        );
        if (
          node.local === "Relationship" &&
          /^external$/i.test(node.attributes.TargetMode?.value ?? "")
        ) {
          const type = node.attributes.Type?.value;
          check(
            type ===
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" ||
              type ===
                "http://purl.oclc.org/ooxml/officeDocument/relationships/hyperlink",
          );
          ignoredHyperlinks = true;
        }
      });
      parser.write(text).close();
      xml.set(name, text);
    }
    pos += 46 + nameLength + extraLength + commentLength;
  }
  check(pos === end);
  spans.sort((a, b) => a[0] - b[0]);
  check(
    spans[0][0] === 0 &&
      spans.every((span, i) => i === 0 || span[0] >= spans[i - 1][1]),
  );
  check(
    xml.has("[Content_Types].xml") &&
      xml.has("_rels/.rels") &&
      xml.has("word/document.xml"),
  );
  check(
    xml
      .get("[Content_Types].xml")
      .includes(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
      ),
  );
  return {
    xml,
    warnings: ignoredHyperlinks
      ? ["External hyperlinks were ignored; no linked content was fetched."]
      : [],
  };
}

// Validate CFB allocations before the dependency can allocate from claimed sizes
// or follow cyclic sector/directory chains. Only in-buffer streams are inspected.
function validateDoc(bytes, limits) {
  check(
    bytes.length >= 512 &&
      bytes.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex")),
  );
  const version = bytes.readUInt16LE(26),
    shift = bytes.readUInt16LE(30);
  check(
    bytes.readUInt16LE(28) === 0xfffe &&
      ((version === 3 && shift === 9) || (version === 4 && shift === 12)) &&
      bytes.readUInt16LE(32) === 6 &&
      bytes.readUInt32LE(56) === 4096,
  );
  const sectorSize = 2 ** shift,
    sectorCount = bytes.length / sectorSize - 1;
  check(Number.isInteger(sectorCount) && sectorCount > 0);
  const sector = (id) => {
    check(id >= 0 && id < sectorCount);
    return bytes.subarray((id + 1) * sectorSize, (id + 2) * sectorSize);
  };
  const fatCount = bytes.readUInt32LE(44),
    difatCount = bytes.readUInt32LE(72);
  check(fatCount > 0 && fatCount <= sectorCount && difatCount <= sectorCount);
  const fatIds = [];
  for (let i = 0; i < 109; i++) {
    const id = bytes.readInt32LE(76 + i * 4);
    if (id >= 0) fatIds.push(id);
  }
  const difatSeen = new Set();
  let difatId = bytes.readInt32LE(68);
  for (let i = 0; i < difatCount; i++) {
    check(!difatSeen.has(difatId));
    difatSeen.add(difatId);
    const block = sector(difatId);
    for (let p = 0; p < sectorSize - 4; p += 4) {
      const id = block.readInt32LE(p);
      if (id >= 0) fatIds.push(id);
    }
    difatId = block.readInt32LE(sectorSize - 4);
  }
  check(
    fatIds.length === fatCount &&
      new Set(fatIds).size === fatCount &&
      (difatCount === 0 || difatId === -2),
  );
  const fat = fatIds.flatMap((id) => {
    const block = sector(id);
    return Array.from({ length: sectorSize / 4 }, (_, i) =>
      block.readInt32LE(i * 4),
    );
  });
  const chain = (start, table = fat, max = sectorCount) => {
    const ids = [],
      seen = new Set();
    let id = start;
    while (id !== -2) {
      check(id >= 0 && id < max && id < table.length && !seen.has(id));
      seen.add(id);
      ids.push(id);
      id = table[id];
    }
    return ids;
  };
  const concat = (ids) => {
    check(ids.length * sectorSize <= limits.maxArchiveBytes, "document_limit");
    return Buffer.concat(ids.map(sector));
  };
  const directory = concat(chain(bytes.readInt32LE(48)));
  check(directory.length > 0);
  const entries = [];
  let entryCount = 0;
  for (let pos = 0; pos < directory.length; pos += 128) {
    const type = directory[pos + 66];
    if (type === 0) {
      entries.push(null);
      continue;
    }
    check(++entryCount <= limits.maxArchiveEntries, "document_limit");
    check([1, 2, 5].includes(type));
    const length = directory.readUInt16LE(pos + 64);
    check(length >= 2 && length <= 64 && length % 2 === 0);
    const name = directory.subarray(pos, pos + length - 2).toString("utf16le");
    check(
      !["__proto__", "constructor", "prototype"].includes(name) &&
        !/\u0000/.test(name),
    );
    if (/^(EncryptionInfo|EncryptedPackage)$/i.test(name))
      fail("encrypted_document");
    check(!/^(VBA|Macros|_VBA_PROJECT|ObjectPool)$/i.test(name));
    const size = directory.readBigUInt64LE(pos + 120);
    check(size <= BigInt(limits.maxArchiveBytes), "document_limit");
    entries.push({
      type,
      name,
      size: Number(size),
      start: directory.readInt32LE(pos + 116),
      pointers: [68, 72, 76].map((off) => directory.readInt32LE(pos + off)),
    });
  }
  check(
    entries[0]?.type === 5 &&
      entries.filter((entry) => entry?.type === 5).length === 1,
  );
  const visited = new Set(),
    inProgress = new Set();
  const visit = (id, depth = 0) => {
    if (id === -1) return;
    check(depth < 100 && entries[id] && !inProgress.has(id));
    if (visited.has(id)) return;
    inProgress.add(id);
    for (const pointer of entries[id].pointers) visit(pointer, depth + 1);
    inProgress.delete(id);
    visited.add(id);
  };
  for (let i = 0; i < entries.length; i++) if (entries[i]) visit(i);
  const miniIds = chain(bytes.readInt32LE(60));
  check(miniIds.length === bytes.readUInt32LE(64));
  const miniBytes = concat(miniIds),
    miniFat = Array.from({ length: miniBytes.length / 4 }, (_, i) =>
      miniBytes.readInt32LE(i * 4),
    );
  const root = entries[0],
    rootIds = chain(root.start);
  check(rootIds.length === Math.ceil(root.size / sectorSize));
  const rootBytes = concat(rootIds).subarray(0, root.size);
  let total = 0,
    word;
  for (const entry of entries) {
    if (entry?.type !== 2 || entry.size === 0) continue;
    total += entry.size;
    check(total <= limits.maxArchiveBytes, "document_limit");
    const mini = entry.size < 4096;
    const ids = mini
      ? chain(entry.start, miniFat, Math.ceil(rootBytes.length / 64))
      : chain(entry.start);
    check(ids.length === Math.ceil(entry.size / (mini ? 64 : sectorSize)));
    if (entry.name === "WordDocument") {
      word = (
        mini
          ? Buffer.concat(
              ids.map((id) => rootBytes.subarray(id * 64, id * 64 + 64)),
            )
          : concat(ids)
      ).subarray(0, entry.size);
    }
  }
  check(word && word.length >= 512 && word.readUInt16LE(0) === 0xa5ec);
  check(!(word.readUInt16LE(10) & 0x8100), "encrypted_document");
}

async function extractPdf(bytes, limits) {
  const { getDocument, VerbosityLevel } =
    await import("pdfjs-dist/legacy/build/pdf.mjs");
  class DenyResourceFetch {
    async fetch() {
      throw new Error("External document resources are disabled.");
    }
  }
  const task = getDocument({
    data: Uint8Array.from(bytes),
    verbosity: VerbosityLevel.ERRORS,
    BinaryDataFactory: DenyResourceFetch,
    useWorkerFetch: false,
    useWasm: false,
    useSystemFonts: false,
    disableFontFace: true,
    enableXfa: false,
    isEvalSupported: false,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    maxImageSize: 0,
    stopAtErrors: true,
  });
  try {
    const pdf = await task.promise;
    check(pdf.numPages <= limits.maxPdfPages, "document_limit");
    const parts = [];
    let length = 0,
      emptyPages = 0;
    const append = (text) => {
      length += text.length;
      // One terminal separator is inserted by us and removed by finishText.
      check(length <= limits.maxTextChars + 1, "document_limit");
      parts.push(text);
    };
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      let hasText = false;
      try {
        for await (const chunk of page.streamTextContent())
          for (const item of chunk.items) {
            if (typeof item.str !== "string") continue;
            if (item.str.trim()) hasText = true;
            append(item.str);
            append(item.hasEOL ? "\n" : " ");
          }
      } finally {
        page.cleanup();
      }
      if (!hasText) emptyPages++;
      if (i < pdf.numPages) append("\n");
    }
    return {
      text: finishText(parts.join(""), limits),
      pageCount: pdf.numPages,
      warnings: emptyPages
        ? [
            `${emptyPages} page(s) had no extractable text; images were not processed with OCR.`,
          ]
        : [],
    };
  } catch (error) {
    if (error.name === "PasswordException") fail("encrypted_document");
    throw error;
  } finally {
    await task.destroy();
  }
}

async function extract({ bytes: transferred, kind, limits }) {
  const bytes = Buffer.from(transferred);
  if (kind === ".txt")
    return { text: finishText(decode(bytes), limits), warnings: [] };
  if (kind === ".pdf") return extractPdf(bytes, limits);
  let document,
    warnings = [];
  if (kind === ".doc" || bytes[0] === 0xd0) {
    validateDoc(bytes, limits);
    check(kind === ".doc");
    const { default: WordExtractor } = await import("word-extractor");
    document = await new WordExtractor().extract(bytes);
  } else {
    const validated = validateDocx(bytes, limits);
    const { xml } = validated;
    warnings = validated.warnings;
    const [{ default: OpenOfficeExtractor }, { default: BufferReader }] =
      await Promise.all([
        import("word-extractor/lib/open-office-extractor.js"),
        import("word-extractor/lib/buffer-reader.js"),
      ]);
    // Pinned word-extractor 1.0.4 decodes each 4096-byte XML chunk separately,
    // corrupting split UTF-8 code points. Feed the already validated, decoded
    // strings to its existing XML parser instead. The archive stays byte-only.
    class ValidatedXmlExtractor extends OpenOfficeExtractor {
      handleEntry(_archive, entry) {
        check(xml.has(entry.fileName));
        this._source = entry.fileName;
        return new Promise((resolve, reject) => {
          const parser = this.createXmlParser();
          parser.on("error", reject);
          parser.on("end", resolve);
          try {
            parser.write(xml.get(entry.fileName)).close();
          } catch (error) {
            reject(error);
          }
        });
      }
    }
    document = await new ValidatedXmlExtractor().extract(
      new BufferReader(bytes),
    );
  }
  const parts = [
    document.getBody({ filterUnicode: false }),
    document.getFootnotes({ filterUnicode: false }),
    document.getEndnotes({ filterUnicode: false }),
    document.getHeaders({ filterUnicode: false }),
    document.getAnnotations({ filterUnicode: false }),
    document.getTextboxes({ filterUnicode: false }),
  ];
  return {
    text: finishText(parts.filter((part) => part?.trim()).join("\n"), limits),
    warnings,
  };
}

if (parentPort) {
  extract(workerData).then(
    (result) => parentPort.postMessage(result),
    (error) =>
      parentPort.postMessage({
        error:
          error instanceof DocumentProcessingError
            ? error.code
            : "invalid_document",
      }),
  );
}
