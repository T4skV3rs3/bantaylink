function createRowParser(onRow) {
  let headers = null;
  let row = [];
  let cell = "";
  let quoted = false;

  const emitRow = () => {
    const values = row;
    row = [];
    if (!values.some(value => String(value ?? "").trim() !== "")) return;
    if (!headers) {
      headers = values.map(value => String(value ?? "").replace(/^\uFEFF/, "").trim());
      return;
    }
    onRow(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  };

  return (text, final = false) => {
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (quoted) {
        if (char === '"' && next === '"') {
          cell += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          cell += char;
        }
        continue;
      }

      if (char === '"') quoted = true;
      else if (char === ",") {
        row.push(cell);
        cell = "";
      } else if (char === "\n") {
        row.push(cell.replace(/\r$/, ""));
        cell = "";
        emitRow();
      } else {
        cell += char;
      }
    }

    if (final) {
      if (quoted) throw new Error("CSV ended inside a quoted field.");
      if (cell.length || row.length) {
        row.push(cell.replace(/\r$/, ""));
        cell = "";
        emitRow();
      }
    }
  };
}

export function parseCsv(text) {
  const rows = [];
  const parser = createRowParser(row => rows.push(row));
  parser(text, true);
  return rows;
}

export async function* parseCsvStream(stream) {
  const decoder = new TextDecoder();
  const queue = [];
  const parser = createRowParser(row => queue.push(row));

  for await (const chunk of stream) {
    parser(decoder.decode(chunk, { stream: true }));
    while (queue.length) yield queue.shift();
  }

  parser(decoder.decode(), true);
  while (queue.length) yield queue.shift();
}
