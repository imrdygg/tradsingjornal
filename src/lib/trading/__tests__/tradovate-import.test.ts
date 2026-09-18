import { describe, it, expect } from 'vitest';
import { parseTradovateCSV, parseCsvRows } from '../tradovate-import';

describe('parseCsvRows', () => {
  it('keeps commas that sit inside quoted fields', () => {
    const rows = parseCsvRows('a,b\n"ACME, LLC",2');
    expect(rows).toEqual([
      ['a', 'b'],
      ['ACME, LLC', '2'],
    ]);
  });

  it('handles escaped quotes and CRLF line endings', () => {
    const rows = parseCsvRows('a,b\r\n"He said ""hi""",1\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['He said "hi"', '1'],
    ]);
  });
});

describe('parseTradovateCSV — orders export with an empty order price', () => {
  // This is the reported failure: the file carries both "Price" (the order /
  // limit price, blank on market orders) and "Fill Price".
  const csv = [
    'Order ID,Account,B/S,Contract,Product,Product Description,Fill Time,Qty,Price,Fill Price',
    '1,"ACME, LLC",Buy,MESZ5,MES,Micro E-mini S&P 500,2026-09-18 09:31:00,2,,7700.00',
    '2,"ACME, LLC",Sell,MESZ5,MES,Micro E-mini S&P 500,2026-09-18 09:35:00,2,,7705.00',
  ].join('\n');

  it('reads the fill price instead of the blank order price', () => {
    const result = parseTradovateCSV(csv);

    expect(result.errors).toEqual([]);
    expect(result.trades).toHaveLength(1);

    const trade = result.trades[0];
    expect(trade.entryPrice).toBe(7700);
    expect(trade.exitPrice).toBe(7705);
    expect(trade.contracts).toBe(2);
    // 5 points * $5/pt * 2 contracts
    expect(trade.grossPnL).toBe(50);
    expect(trade.status).toBe('closed');
    expect(result.detectedColumns.price).toBe('Fill Price');
  });

  it('does not report invalid-price errors on the unfilled rows', () => {
    const result = parseTradovateCSV(csv);
    expect(result.errors.join(' ')).not.toMatch(/invalid price/i);
  });
});

describe('parseTradovateCSV — fills export and instrument pricing', () => {
  const csv = [
    'Timestamp,Symbol,Action,Qty,Price',
    '2026-09-18 09:31:00,MNQU6,Buy,1,20000.00',
    '2026-09-18 09:33:00,MNQU6,Buy,3,19990.00',
    '2026-09-18 09:40:00,MNQU6,Sell,4,20000.00',
  ].join('\n');

  it('matches a scale-in and prices it with MNQ’s $2/point', () => {
    const result = parseTradovateCSV(csv);

    expect(result.errors).toEqual([]);
    expect(result.trades).toHaveLength(1);

    const trade = result.trades[0];
    // (1*20000 + 3*19990) / 4 = 19992.50
    expect(trade.entryPrice).toBe(19992.5);
    expect(trade.contracts).toBe(4);
    expect(trade.instrumentId).toBe('mnq');
    // 7.5 points * $2/pt * 4 contracts
    expect(trade.grossPnL).toBe(60);
  });

  it('groups every leg of one position under a shared positionId', () => {
    const result = parseTradovateCSV(csv);
    expect(result.trades[0].positionId).toBeTruthy();
  });
});

describe('parseTradovateCSV — scale-outs', () => {
  const csv = [
    'Timestamp,Symbol,Action,Qty,Price',
    '2026-09-18 09:31:00,MESZ5,Buy,4,7700.00',
    '2026-09-18 09:45:00,MESZ5,Sell,2,7710.00',
    '2026-09-18 10:05:00,MESZ5,Sell,2,7720.00',
  ].join('\n');

  it('splits a partial exit into its own leg and links it to the position', () => {
    const result = parseTradovateCSV(csv);

    expect(result.trades).toHaveLength(2);
    const [first, second] = result.trades;

    expect(first.contracts).toBe(2);
    expect(first.exitPrice).toBe(7710);
    expect(first.grossPnL).toBe(100); // 10 pts * $5 * 2

    expect(second.contracts).toBe(2);
    expect(second.exitPrice).toBe(7720);
    expect(second.grossPnL).toBe(200); // 20 pts * $5 * 2

    // Both legs belong to the same position.
    expect(first.positionId).toBeTruthy();
    expect(first.positionId).toBe(second.positionId);
    expect(first.entryPrice).toBe(7700);
    expect(second.entryPrice).toBe(7700);
  });
});

describe('parseTradovateCSV — unresolved positions', () => {
  it('leaves a position that never closed as an open trade', () => {
    const csv = [
      'Timestamp,Symbol,Action,Qty,Price',
      '2026-09-18 09:31:00,MESZ5,Buy,2,7700.00',
    ].join('\n');

    const result = parseTradovateCSV(csv);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].status).toBe('open');
    expect(result.trades[0].contracts).toBe(2);
    expect(result.unmatchedFills).toHaveLength(1);
  });
});

describe('parseTradovateCSV — unhelpful files', () => {
  it('explains an all-unfilled order export instead of listing row errors', () => {
    const csv = [
      'Timestamp,Symbol,Action,Qty,Price,Fill Price',
      '2026-09-18 09:31:00,MESZ5,Buy,2,,',
      '2026-09-18 09:35:00,MESZ5,Sell,2,,',
    ].join('\n');

    const result = parseTradovateCSV(csv);
    expect(result.trades).toHaveLength(0);
    expect(result.skippedRows).toBe(2);
    expect(result.errors[0]).toMatch(/no filled orders found/i);
  });

  it('names the columns it was looking for when the header is wrong', () => {
    const result = parseTradovateCSV('foo,bar\n1,2');
    expect(result.errors[0]).toMatch(/Could not find/i);
    expect(result.errors[0]).toMatch(/price column/i);
  });

  it('always explains the placeholder stop it had to invent', () => {
    const csv = [
      'Timestamp,Symbol,Action,Qty,Price',
      '2026-09-18 09:31:00,MESZ5,Buy,1,7700.00',
      '2026-09-18 09:35:00,MESZ5,Sell,1,7705.00',
    ].join('\n');

    const result = parseTradovateCSV(csv);
    expect(result.warnings.join(' ')).toMatch(/placeholder 10-point stop/i);
    // 10 point placeholder stop on 1 MES contract = $50.
    expect(result.trades[0].initialRisk).toBe(50);
    expect(result.trades[0].initialStop).toBe(7690);
  });

  it('flags the invented stop as assumed on every imported trade', () => {
    const csv = [
      'Timestamp,Symbol,Action,Qty,Price',
      '2026-09-18 09:31:00,MESZ5,Buy,1,7700.00',
      '2026-09-18 09:35:00,MESZ5,Sell,1,7705.00',
    ].join('\n');

    const result = parseTradovateCSV(csv);
    // The flag is what lets the app warn about placeholder risk and R instead of
    // presenting invented numbers as if they were the trader's own.
    expect(result.trades[0].riskSource).toBe('assumed');
  });

  it('flags a position that is still open as assumed too', () => {
    const csv = [
      'Timestamp,Symbol,Action,Qty,Price',
      '2026-09-18 09:31:00,MESZ5,Buy,2,7700.00',
    ].join('\n');

    const result = parseTradovateCSV(csv);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].status).toBe('open');
    expect(result.trades[0].riskSource).toBe('assumed');
  });

  it('tells the trader where to fix the placeholder risk', () => {
    const csv = [
      'Timestamp,Symbol,Action,Qty,Price',
      '2026-09-18 09:31:00,MESZ5,Buy,1,7700.00',
      '2026-09-18 09:35:00,MESZ5,Sell,1,7705.00',
    ].join('\n');

    const result = parseTradovateCSV(csv);
    expect(result.warnings.join(' ')).toMatch(/Fix imported risk/i);
  });
});
