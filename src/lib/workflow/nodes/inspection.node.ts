/**
 * `inspection` — test + condition-grade bench. The domain work (serial status
 * transition, tech_serial_numbers audit, testing_results feed, line rollup)
 * is owned by src/lib/tech/recordTestVerdict, which taps `test_verdict` after
 * its writes land. Verdict → port: PASS → `pass`, TESTING_FAILED → `fail`,
 * TEST_AGAIN re-parks (the unit stays on the bench). Stage span:
 * AWAITING_TEST ④ → PASSED/FAILED ⑥ (workflow-stages.ts).
 */

import { registerNode } from '../registry';
import { stationNode } from './station-node';

registerNode(
  stationNode({
    type: 'inspection',
    label: 'Test / Grade',
    icon: 'ClipboardCheck',
    category: 'process',
    outputs: [
      { id: 'pass', label: 'Pass' },
      { id: 'fail', label: 'Fail' },
    ],
    port: (input) => {
      if (input.event !== 'test_verdict') return null;
      if (input.verdict === 'PASS') return 'pass';
      if (input.verdict === 'TESTING_FAILED') return 'fail';
      return null; // TEST_AGAIN — re-queued, still at the bench
    },
    data: (ctx) => ({
      verdict: ctx.input.verdict,
      testedBy: ctx.actor.staffId,
    }),
  }),
);
