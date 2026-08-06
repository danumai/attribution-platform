// Self-check for the metrics exposition. No DB, no server.
//
// The thing worth testing here is not that a counter counts — it is that a label can never
// break the output format or mint an unbounded number of series, because a metrics endpoint
// that does either takes the scrape target down rather than the app.
import { strict as assert } from 'assert';
import { count, recordDecision, renderMetrics } from '../src/common/obs';

const uniq = `t${Math.random().toString(36).slice(2)}`;

count(`${uniq}_plain`);
count(`${uniq}_plain`);
assert.match(renderMetrics(), new RegExp(`^${uniq}_plain 2$`, 'm'), 'unlabelled counter accumulates');

// Same name, different labels: one family, one TYPE header, a series per label set.
count(`${uniq}_family`, { reason: 'no_match' });
count(`${uniq}_family`, { reason: 'no_match' });
count(`${uniq}_family`, { reason: 'ambiguous' });
const out = renderMetrics();
assert.match(out, new RegExp(`^${uniq}_family\\{reason="no_match"\\} 2$`, 'm'));
assert.match(out, new RegExp(`^${uniq}_family\\{reason="ambiguous"\\} 1$`, 'm'));
assert.equal(
  out.split('\n').filter((l) => l === `# TYPE ${uniq}_family counter`).length,
  1,
  'one TYPE header per family, not per series — a repeated header is a malformed scrape',
);

// A label value carrying a quote, a backslash or a newline would otherwise terminate the line
// early and corrupt every metric after it in the response.
count(`${uniq}_evil`, { v: 'a"b\\c\nd' });
const evil = renderMetrics()
  .split('\n')
  .find((l) => l.startsWith(`${uniq}_evil`))!;
assert.equal(evil, `${uniq}_evil{v="abcd"} 1`, 'quotes, backslashes and newlines are stripped');

// An attributed decision and a refused one must land in the same family, separated only by
// `reason` — that is what makes "refusal rate" a single query rather than a join.
recordDecision('first_open', { match_method: 'referrer', confidence: 100 });
recordDecision('first_open', { reason: 'no_match' });
const dec = renderMetrics();
assert.match(
  dec,
  /^attribution_decisions_total\{stage="first_open",reason="attributed",match_method="referrer"\} \d+$/m,
  'a paid decision is counted as `attributed`, not omitted',
);
assert.match(
  dec,
  /^attribution_decisions_total\{stage="first_open",reason="no_match",match_method="none"\} \d+$/m,
  'a refusal still reports a match_method, so the label set is stable across outcomes',
);

console.log('  ✓ obs self-check passed');
