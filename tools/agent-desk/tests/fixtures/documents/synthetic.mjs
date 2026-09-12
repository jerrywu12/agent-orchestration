import { crc32, deflateRawSync } from "node:zlib";

// Deliberately generated documents: no real user files, Office, or external tools.
export function zip(entries) {
  const local = [],
    central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data ?? "");
    const method = entry.method ?? 8;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const flags = entry.flags ?? 0x800;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(entry.declaredSize ?? data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const index = Buffer.alloc(46);
    index.writeUInt32LE(0x02014b50);
    index.writeUInt16LE(20, 4);
    index.writeUInt16LE(20, 6);
    index.writeUInt16LE(flags, 8);
    index.writeUInt16LE(method, 10);
    index.writeUInt32LE(crc32(data), 16);
    index.writeUInt32LE(compressed.length, 20);
    index.writeUInt32LE(entry.declaredSize ?? data.length, 24);
    index.writeUInt16LE(name.length, 28);
    index.writeUInt32LE(offset, 42);
    local.push(header, name, compressed);
    central.push(index, name);
    offset += header.length + name.length + compressed.length;
  }
  const table = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(table.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, table, end]);
}

export function docxEntries(text = "Readable Word document 中文") {
  const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  return [
    {
      name: "[Content_Types].xml",
      data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: "_rels/.rels",
      data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    {
      name: "word/document.xml",
      data: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escaped}</w:t></w:r></w:p></w:body></w:document>`,
    },
  ];
}
export const docx = (text) => zip(docxEntries(text));

export function pdf(
  text = "Readable PDF document",
  { pages = 1, encrypted = false } = {},
) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let i = 0; i < pages; i++) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    const content = text
      ? `BT /F1 12 Tf 40 750 Td (${text.replace(/[\\()]/g, "\\$&")}) Tj ET`
      : "";
    objects.push(
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    );
  }
  if (encrypted)
    objects.push(
      "<< /Filter /Standard /V 1 /R 2 /Length 40 /O <0000000000000000000000000000000000000000000000000000000000000000> /U <0000000000000000000000000000000000000000000000000000000000000000> /P -4 >>",
    );
  let out = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  out += offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("");
  out += `trailer\n<< /Size ${offsets.length} /Root 1 0 R${encrypted ? ` /Encrypt ${objects.length} 0 R /ID [<00112233445566778899aabbccddeeff><00112233445566778899aabbccddeeff>]` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

// Minimal Word97 CFB: one FAT, one directory sector, two 4096-byte streams.
// The WordDocument FIB and 0Table contain a single Unicode text piece.
export function doc(
  text = "Legacy Word document 中文",
  { encrypted = false } = {},
) {
  const out = Buffer.alloc(512 * 19);
  Buffer.from("d0cf11e0a1b11ae1", "hex").copy(out);
  out.writeUInt16LE(0x3e, 24);
  out.writeUInt16LE(3, 26);
  out.writeUInt16LE(0xfffe, 28);
  out.writeUInt16LE(9, 30);
  out.writeUInt16LE(6, 32);
  out.writeUInt32LE(1, 44);
  out.writeUInt32LE(1, 48);
  out.writeUInt32LE(4096, 56);
  out.writeUInt32LE(0xfffffffe, 60);
  out.writeUInt32LE(0xfffffffe, 68);
  out.fill(0xff, 76, 512);
  out.writeUInt32LE(0, 76);
  const fat = out.subarray(512, 1024);
  fat.fill(0xff);
  fat.writeUInt32LE(0xfffffffd, 0);
  fat.writeUInt32LE(0xfffffffe, 4);
  for (let i = 2; i < 18; i++)
    fat.writeUInt32LE(i === 9 || i === 17 ? 0xfffffffe : i + 1, i * 4);
  const directory = out.subarray(1024, 1536);
  function entry(
    index,
    name,
    type,
    start,
    size,
    child = 0xffffffff,
    right = 0xffffffff,
  ) {
    const at = index * 128;
    Buffer.from(`${name}\0`, "utf16le").copy(directory, at);
    directory.writeUInt16LE((name.length + 1) * 2, at + 64);
    directory[at + 66] = type;
    directory[at + 67] = 1;
    directory.writeUInt32LE(0xffffffff, at + 68);
    directory.writeUInt32LE(right, at + 72);
    directory.writeUInt32LE(child, at + 76);
    directory.writeUInt32LE(start, at + 116);
    directory.writeBigUInt64LE(BigInt(size), at + 120);
  }
  entry(0, "Root Entry", 5, 0xfffffffe, 0, 1);
  entry(1, "WordDocument", 2, 2, 4096, 0xffffffff, 2);
  entry(2, "0Table", 2, 10, 4096);
  const word = out.subarray(1536, 5632);
  word.writeUInt16LE(0xa5ec, 0);
  word.writeUInt16LE(0xc1, 2);
  word.writeUInt16LE(encrypted ? 0x100 : 0, 10);
  word.writeUInt32LE(512, 0x18);
  word.writeUInt32LE(text.length, 0x4c);
  Buffer.from(text, "utf16le").copy(word, 512);
  const table = out.subarray(5632, 9728);
  table[0] = 2;
  table.writeUInt32LE(16, 1);
  table.writeUInt32LE(0, 5);
  table.writeUInt32LE(text.length, 9);
  table.writeUInt32LE(512, 15);
  return out;
}
