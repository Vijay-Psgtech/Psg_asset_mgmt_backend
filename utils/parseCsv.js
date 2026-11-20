const { ValidationError } = require('./errors');

function parseCsv(input) {
  const text = input.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  let closedQuote = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"') {
      if (value.length || closedQuote) {
        throw new ValidationError('CSV contains an unexpected quote');
      }
      quoted = true;
    } else if (character === ',') {
      row.push(value);
      value = '';
      closedQuote = false;
    } else if (character === '\n' || character === '\r') {
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = '';
      closedQuote = false;
      if (character === '\r' && text[index + 1] === '\n') index += 1;
    } else if (closedQuote) {
      if (!/\s/.test(character)) {
        throw new ValidationError('CSV contains unexpected characters after a quoted value');
      }
    } else {
      value += character;
    }
  }

  if (quoted) throw new ValidationError('CSV contains an unclosed quoted value');
  if (row.length || value.length || closedQuote) {
    row.push(value);
    if (row.some((cell) => cell.trim())) rows.push(row);
  }
  return rows;
}

module.exports = { parseCsv };
