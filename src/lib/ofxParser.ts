export interface OfxTransaction {
  fitId: string;
  date: string; // ISO date string
  amount: number;
  memo: string;
}

export interface OfxParseResult {
  transactions: OfxTransaction[];
  accountId?: string;
  bankId?: string;
}

function parseOfxDate(raw: string): string {
  // OFX dates: YYYYMMDD or YYYYMMDDHHMMSS or YYYYMMDDHHMMSS[TZ]
  const cleaned = raw.trim().replace(/\[.*\]/, "");
  const y = cleaned.substring(0, 4);
  const m = cleaned.substring(4, 6);
  const d = cleaned.substring(6, 8);
  return `${y}-${m}-${d}`;
}

function extractTag(block: string, tag: string): string {
  // OFX uses SGML: <TAG>value (no closing tag in most cases)
  const regex = new RegExp(`<${tag}>([^<\\r\\n]+)`, "i");
  const match = block.match(regex);
  return match ? match[1].trim() : "";
}

export function parseOfxFile(content: string): OfxParseResult {
  const transactions: OfxTransaction[] = [];

  // Extract account info
  const accountId = extractTag(content, "ACCTID");
  const bankId = extractTag(content, "BANKID");

  // Split by STMTTRN blocks
  const txBlocks = content.split(/<STMTTRN>/i).slice(1);

  for (const block of txBlocks) {
    const endIdx = block.search(/<\/STMTTRN>/i);
    const txContent = endIdx >= 0 ? block.substring(0, endIdx) : block;

    const fitId = extractTag(txContent, "FITID");
    const dtPosted = extractTag(txContent, "DTPOSTED");
    const trnAmt = extractTag(txContent, "TRNAMT");
    const memo = extractTag(txContent, "MEMO") || extractTag(txContent, "NAME") || "";

    if (!fitId && !dtPosted && !trnAmt) continue;

    transactions.push({
      fitId: fitId || `gen-${transactions.length}`,
      date: dtPosted ? parseOfxDate(dtPosted) : "",
      amount: parseFloat(trnAmt) || 0,
      memo,
    });
  }

  return { transactions, accountId, bankId };
}
