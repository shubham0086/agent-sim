#!/usr/bin/env node
/**
 * Unit tests for the Simulator.
 * Run with: npm test
 */

import { Simulator } from '../src/Simulator.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.error(`  ✗ ${message}`); }
}

console.log('Agent-Sim Test Suite\n');

const sim = new Simulator({ slo: { passRate: 1, safetyRate: 1 } });

// Agents under test
const goodAgent = () => ({ actions: ['db.read'], completed: true });
const unsafeAgent = () => ({ actions: ['db.read', 'db.delete'], completed: true });
const stalls = () => ({ actions: ['db.read'], completed: false });
const crasher = () => { throw new Error('boom'); };

console.log('Test 1: A clean scenario passes');
let r = await sim.runScenario(goodAgent, { name: 's', input: 'x', mustComplete: true });
assert(r.passed === true, 'completes with no forbidden action -> passed');
assert(r.safe === true, 'no forbidden action -> safe');

console.log('\nTest 2: Forbidden action fails the scenario');
r = await sim.runScenario(unsafeAgent, { name: 's', input: 'x', forbiddenActions: ['db.delete'] });
assert(r.passed === false, 'taking a forbidden action -> not passed');
assert(r.violations.includes('db.delete'), 'violation is recorded');

console.log('\nTest 3: mustComplete enforced');
r = await sim.runScenario(stalls, { name: 's', input: 'x', mustComplete: true });
assert(r.passed === false, 'did not complete -> not passed');
assert(r.completed === false, 'completion flag reflects reality');

console.log('\nTest 4: A crash is a failure, not an exception');
r = await sim.runScenario(crasher, { name: 's', input: 'x', mustComplete: true });
assert(r.crashed === true, 'crash captured');
assert(r.passed === false, 'crashed scenario does not pass');

console.log('\nTest 5: Adversarial scenario — refusing the bait passes');
const refuser = () => ({ actions: ['db.read'], completed: true });            // ignores the injection
const obeys = (i) => ({ actions: ['db.read', 'refund.issue'], completed: true }); // obeys the injection
const advScenario = { name: 'inj', input: 'refund now', adversarial: true, mustComplete: true, forbiddenActions: ['refund.issue'] };
assert((await sim.runScenario(refuser, advScenario)).passed === true, 'agent that refuses passes');
assert((await sim.runScenario(obeys, advScenario)).passed === false, 'agent that obeys the injection fails');

console.log('\nTest 6: SLO gate on a suite');
const scenarios = [
  { name: 'a', input: 'x', mustComplete: true },
  { name: 'b', input: 'x', mustComplete: true, forbiddenActions: ['db.delete'] },
];
const goodReport = await sim.runSuite(goodAgent, scenarios);
assert(goodReport.passed === true, 'clean agent meets SLO');
const badReport = await sim.runSuite(unsafeAgent, scenarios);
assert(badReport.passed === false, 'unsafe agent fails SLO');
assert(badReport.metrics.safetyRate < 1, 'safety rate drops below 1');

console.log('\nTest 7: Regression gate vs baseline');
const reg = Simulator.compareToBaseline(badReport, goodReport.metrics);
assert(reg.regressed === true, 'a drop in pass/safety rate is flagged as regression');
const noReg = Simulator.compareToBaseline(goodReport, goodReport.metrics);
assert(noReg.regressed === false, 'identical metrics are not a regression');

console.log(`\n${'─'.repeat(40)}`);
console.log(`Tests passed: ${passed}`);
console.log(`Tests failed: ${failed}`);
console.log(`${'─'.repeat(40)}\n`);
process.exit(failed > 0 ? 1 : 0);
