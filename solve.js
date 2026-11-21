// Fast drop-in for csv-reader 1.0.0: run(input) returns exactly {columns, rows, errors}
// for {text, header}, with csv-reader's broken-row policy, but without its
// character-at-a-time loop. Strategy: bulk native scans (indexOf / slice / split)
// instead of per-character appends.
//
//  - A record whose physical line holds no '"' and no stray CR is taken whole:
//    one slice + split(',') yields all its fields.
//  - In any other record, runs of consecutive unquoted fields are taken the same
//    way: one split(',') over the run up to the next field-opening quote (a quote
//    is a field opener only at a field start; mid-field it is literal, and that
//    field falls back to the scanner). A quoted field is found with indexOf('"')
//    and its content is one slice unless it holds doubled quotes or line breaks.
//  - The slow corners (stray CRs, quote junk, unterminated quotes, quoted line
//    breaks) follow the reference policy exactly; they are rare, so they may
//    loop. Nothing is kept from one call to the next.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and its index in rows (null: header).
  let recLine = 1;
  let recRow = null;

  // Out-parameters of the field readers below.
  let fEnded = END;
  let fAdded = 0;

  // A quoted segment's CRs become LFs and each counts one line, exactly as the
  // reference reads CRLF and lone CR inside quotes. Returns the fixed segment.
  function fixSeg(seg) {
    if (seg.indexOf('\r') === -1) {
      let n = 0;
      let i = seg.indexOf('\n');
      while (i !== -1) {
        n += 1;
        i = seg.indexOf('\n', i + 1);
      }
      line += n;
      return seg;
    }
    const conv = seg.replace(/\r\n?/g, '\n');
    let n = 0;
    let i = conv.indexOf('\n');
    while (i !== -1) {
      n += 1;
      i = conv.indexOf('\n', i + 1);
    }
    line += n;
    return conv;
  }

  // Reads unquoted characters onto `init` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Sets fEnded and fAdded
  // (the characters kept by this read).
  function unq(init) {
    let value = init;
    let added = 0;
    for (;;) {
      const ci = text.indexOf(',', pos);
      const ni = text.indexOf('\n', pos);
      const ri = text.indexOf('\r', pos);
      let m = -1;
      let kind = -1;
      if (ci !== -1) {
        m = ci;
        kind = COMMA;
      }
      if (ni !== -1 && (m === -1 || ni < m)) {
        m = ni;
        kind = LINE_BREAK;
      }
      if (ri !== -1 && (m === -1 || ri < m)) {
        m = ri;
        kind = 2;
      }
      if (m === -1) {
        if (pos < len) {
          value += text.slice(pos);
          added += len - pos;
        }
        pos = len;
        fEnded = END;
        fAdded = added;
        return value;
      }
      if (kind === COMMA) {
        if (m > pos) {
          value += text.slice(pos, m);
          added += m - pos;
        }
        pos = m + 1;
        fEnded = COMMA;
        fAdded = added;
        return value;
      }
      if (kind === LINE_BREAK) {
        if (m > pos) {
          value += text.slice(pos, m);
          added += m - pos;
        }
        pos = m + 1;
        line += 1;
        fEnded = LINE_BREAK;
        fAdded = added;
        return value;
      }
      // A CR: CRLF ends the field, a lone CR is dropped with stray_cr.
      if (text.charCodeAt(m + 1) === 10) {
        if (m > pos) {
          value += text.slice(pos, m);
          added += m - pos;
        }
        pos = m + 2;
        line += 1;
        fEnded = LINE_BREAK;
        fAdded = added;
        return value;
      }
      if (m > pos) {
        value += text.slice(pos, m);
        added += m - pos;
      }
      errors.push({ code: 'stray_cr', line: recLine, row: recRow });
      pos = m + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Sets fEnded; fAdded is
  // 0 except on the junk path, where unq() sets it.
  function quo() {
    const open = pos;
    const openLine = line;
    let segStart = pos + 1;
    let val = '';
    let single = true;
    for (;;) {
      const q = text.indexOf('"', segStart);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one literal quote, and the scan goes on.
        val += fixSeg(text.slice(segStart, q + 1));
        single = false;
        segStart = q + 2;
        continue;
      }
      // The closing quote.
      const seg = fixSeg(text.slice(segStart, q));
      if (single) val = seg;
      else val += seg;
      pos = q + 1;
      if (pos >= len) {
        fEnded = END;
        fAdded = 0;
        return val;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        fEnded = COMMA;
        fAdded = 0;
        return val;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        fEnded = LINE_BREAK;
        fAdded = 0;
        return val;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        fEnded = LINE_BREAK;
        fAdded = 0;
        return val;
      }
      // What follows the closing quote is appended as it stands.
      const v = unq(val);
      if (fAdded > 0) errors.push({ code: 'quote_junk', line: recLine, row: recRow });
      return v;
    }
    // The quote never closes: it is a literal character, and the text after it
    // is read again as unquoted.
    pos = open + 1;
    line = openLine;
    errors.push({ code: 'unterminated_quote', line: recLine, row: recRow });
    return unq('"');
  }

  // Applies one finished record: header, width, short/long rows.
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row: recRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recLine = line;
    recRow = header && columns === null ? null : rows.length;

    // Fast path: this physical line holds no quote and no stray CR, so it is
    // one whole record (a trailing CR is its CRLF ending).
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? len : nl;
    const qi = text.indexOf('"', pos);
    if (qi === -1 || qi >= end) {
      const ri = text.indexOf('\r', pos);
      if (ri === -1 || (nl !== -1 && ri === end - 1)) {
        let contentEnd = end;
        if (ri === end - 1) contentEnd = end - 1;
        if (contentEnd === pos) {
          // An empty line: no record.
          pos = nl === -1 ? len : nl + 1;
          if (nl !== -1) line += 1;
          continue;
        }
        const fields = text.slice(pos, contentEnd).split(',');
        pos = nl === -1 ? len : nl + 1;
        if (nl !== -1) line += 1;
        finishRecord(fields);
        continue;
      }
    }

    // Slow path: quoted fields one by one, runs of unquoted fields by split.
    const fields = [];
    let lastQuoted = false;
    let done = false;
    while (!done) {
      if (text.charCodeAt(pos) === 34) {
        lastQuoted = true;
        fields.push(quo());
        if (fEnded !== COMMA) done = true;
        continue;
      }
      // An unquoted run: up to the next quote or the end of the line.
      const nq = text.indexOf('"', pos);
      let nl2 = text.indexOf('\n', pos);
      if (nl2 === -1) nl2 = len;
      if (nq === -1 || nq >= nl2) {
        // No quote before the line ends: the tail of the record is plain.
        const ri2 = text.indexOf('\r', pos);
        if (ri2 !== -1 && ri2 < nl2 && !(nl2 < len && ri2 === nl2 - 1)) {
          // A stray CR in the tail: one field the slow way.
          lastQuoted = false;
          fields.push(unq(''));
          if (fEnded !== COMMA) done = true;
          continue;
        }
        const segEnd = nl2 < len && ri2 === nl2 - 1 ? nl2 - 1 : nl2;
        if (segEnd === pos) {
          fields.push('');
        } else {
          const tail = text.slice(pos, segEnd).split(',');
          for (let i = 0; i < tail.length; i++) fields.push(tail[i]);
        }
        lastQuoted = false;
        pos = nl2 < len ? nl2 + 1 : len;
        if (nl2 < len) line += 1;
        fEnded = nl2 < len ? LINE_BREAK : END;
        done = true;
        continue;
      }
      // A quote starts a field ahead: the fields before it are plain, unless
      // the quote sits mid-field (then it is literal: one field the slow way).
      if (nq > pos && text.charCodeAt(nq - 1) !== 44) {
        lastQuoted = false;
        fields.push(unq(''));
        if (fEnded !== COMMA) done = true;
        continue;
      }
      const ri2 = text.indexOf('\r', pos);
      if (ri2 !== -1 && ri2 < nq) {
        // A stray CR in the run: one field the slow way.
        lastQuoted = false;
        fields.push(unq(''));
        if (fEnded !== COMMA) done = true;
        continue;
      }
      if (nq > pos) {
        const runFields = text.slice(pos, nq).split(',');
        runFields.pop(); // the empty piece before the opening quote
        for (let i = 0; i < runFields.length; i++) fields.push(runFields[i]);
      }
      pos = nq;
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    finishRecord(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
