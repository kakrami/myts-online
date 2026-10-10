const enc = new TextEncoder(),
  xml = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
function crc(a) {
  let v = 0xffffffff;
  for (const b of a) {
    v ^= b;
    for (let i = 0; i < 8; i++) v = (v >>> 1) ^ (v & 1 ? 0xedb88320 : 0);
  }
  return (v ^ 0xffffffff) >>> 0;
}
function record(n) {
  const a = new Uint8Array(n);
  return { a, v: new DataView(a.buffer) };
}
function zip(files) {
  const chunks = [],
    central = [];
  let offset = 0,
    size = 0;
  for (const [name, content] of files) {
    const bytes = enc.encode(content),
      fn = enc.encode(name),
      c = crc(bytes),
      h = record(30 + fn.length);
    h.v.setUint32(0, 0x04034b50, true);
    h.v.setUint16(4, 20, true);
    h.v.setUint32(14, c, true);
    h.v.setUint32(18, bytes.length, true);
    h.v.setUint32(22, bytes.length, true);
    h.v.setUint16(26, fn.length, true);
    h.a.set(fn, 30);
    chunks.push(h.a, bytes);
    const d = record(46 + fn.length);
    d.v.setUint32(0, 0x02014b50, true);
    d.v.setUint16(4, 20, true);
    d.v.setUint16(6, 20, true);
    d.v.setUint32(16, c, true);
    d.v.setUint32(20, bytes.length, true);
    d.v.setUint32(24, bytes.length, true);
    d.v.setUint16(28, fn.length, true);
    d.v.setUint32(42, offset, true);
    d.a.set(fn, 46);
    central.push(d.a);
    size += d.a.length;
    offset += h.a.length + bytes.length;
  }
  const end = record(22);
  end.v.setUint32(0, 0x06054b50, true);
  end.v.setUint16(8, files.length, true);
  end.v.setUint16(10, files.length, true);
  end.v.setUint32(12, size, true);
  end.v.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end.a], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
export function download(blob, name) {
  const u = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}
export function excel(rows, name = "myts.xlsx") {
  const alphabet = (i) => {
      let s = "",
        n = i + 1;
      while (n) {
        n--;
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26);
      }
      return s;
    },
    sheet =
      '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      rows
        .map(
          (row, r) =>
            '<row r="' +
            (r + 1) +
            '">' +
            row
              .map((v, c) =>
                typeof v === "number" && Number.isFinite(v)
                  ? `<c r="${alphabet(c)}${r + 1}"><v>${v}</v></c>`
                  : `<c r="${alphabet(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`,
              )
              .join("") +
            "</row>",
        )
        .join("") +
      "</sheetData></worksheet>";
  download(
    zip([
      [
        "[Content_Types].xml",
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      ],
      [
        "_rels/.rels",
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ],
      [
        "xl/workbook.xml",
        '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="myTS" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ],
      [
        "xl/_rels/workbook.xml.rels",
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ],
      ["xl/worksheets/sheet1.xml", sheet],
    ]),
    name,
  );
}
