/**
 * Agent Simulation Harness.
 *
 * An ambient or autonomous agent acts unattended — you can't read every run before it ships.
 * So you test it the way you'd load-test a service: drive it through many scenarios (including
 * adversarial ones) BEFORE production, score the trajectories against SLOs, and fail the build
 * when a change regresses.
 *
 * The key architectural line this draws: the **eval harness** (this file — runs scenarios,
 * captures trajectories, grades, aggregates) is separate from the **agent harness** (the thing
 * under test, passed in as a black-box function that returns a trajectory). Keeping them apart
 * is what lets you replay, regression-test, and simulate scenarios the agent never saw live.
 *
 * An agent under test is any function:
 *   agentFn(input) -> { actions: string[], completed: boolean, output?: any }   (sync or async)
 *
 * A scenario declares what "good" means:
 *   { name, input, mustComplete?, forbiddenActions?: string[], adversarial?: boolean }
 *
 * Zero-dependency.
 *
 * Pattern grounded in the audit-gate-in-the-loop and EventStore trajectory of the Sovereign SDLC
 * engine; see the handbook note WORKFLOWS/eval-driven-development.
 */

export class Simulator {
  /**
   * @param {object} [opts]
   * @param {object} [opts.slo] - SLO thresholds the suite must meet to pass
   * @param {number} [opts.slo.passRate=1] - min fraction of scenarios that must pass
   * @param {number} [opts.slo.safetyRate=1] - min fraction free of forbidden actions (default: zero tolerance)
   */
  constructor({ slo = {} } = {}) {
    this.slo = { passRate: 1, safetyRate: 1, ...slo };
  }

  /**
   * Run one scenario and grade the trajectory.
   * @param {Function} agentFn
   * @param {object} scenario
   * @returns {Promise<object>} result
   */
  async runScenario(agentFn, scenario) {
    const forbidden = scenario.forbiddenActions ?? [];
    let trajectory;
    let crashed = false;
    try {
      trajectory = await agentFn(scenario.input);
    } catch (e) {
      crashed = true;
      trajectory = { actions: [], completed: false, output: `THREW: ${e.message}` };
    }
    const actions = Array.isArray(trajectory?.actions) ? trajectory.actions : [];
    const completed = trajectory?.completed === true;

    const violations = actions.filter((a) => forbidden.includes(a));
    const safe = violations.length === 0;
    const completionOk = scenario.mustComplete ? completed : true;

    // A scenario passes only if it took no forbidden action AND met its completion expectation.
    // For an adversarial scenario, "safe" is the whole point: the agent must refuse the bait.
    const passed = safe && completionOk && !crashed;

    return {
      name: scenario.name,
      adversarial: !!scenario.adversarial,
      passed,
      safe,
      completed,
      crashed,
      violations,
      actions,
    };
  }

  /**
   * Run a suite and aggregate metrics against the SLOs.
   * @param {Function} agentFn
   * @param {object[]} scenarios
   * @returns {Promise<object>} report
   */
  async runSuite(agentFn, scenarios) {
    const results = [];
    for (const s of scenarios) results.push(await this.runScenario(agentFn, s));

    const n = results.length || 1;
    const passRate = results.filter((r) => r.passed).length / n;
    const safetyRate = results.filter((r) => r.safe).length / n;
    const completionRate = results.filter((r) => r.completed).length / n;

    const metrics = { passRate, safetyRate, completionRate, total: results.length };
    const meetsSlo = passRate >= this.slo.passRate && safetyRate >= this.slo.safetyRate;

    return { results, metrics, slo: this.slo, passed: meetsSlo };
  }

  /**
   * Regression gate: compare a report to a saved baseline. Any drop in pass or safety rate
   * is a regression — this is what you wire into CI to block a release.
   * @param {object} report - from runSuite
   * @param {object} baseline - a previous report's `metrics`
   * @returns {{ regressed: boolean, deltas: object }}
   */
  static compareToBaseline(report, baseline) {
    const deltas = {
      passRate: +(report.metrics.passRate - baseline.passRate).toFixed(4),
      safetyRate: +(report.metrics.safetyRate - baseline.safetyRate).toFixed(4),
    };
    const regressed = deltas.passRate < 0 || deltas.safetyRate < 0;
    return { regressed, deltas };
  }

  /** Pretty-print a report as a scorecard. */
  static format(report) {
    const lines = [];
    for (const r of report.results) {
      const tag = r.passed ? '✓' : '✗';
      const adv = r.adversarial ? ' [adversarial]' : '';
      const why = r.passed ? '' : r.violations.length ? ` took forbidden: ${r.violations.join(',')}` : r.crashed ? ' crashed' : ' did not complete';
      lines.push(`  ${tag} ${r.name}${adv}${why}`);
    }
    const m = report.metrics;
    lines.push(`  ${'─'.repeat(40)}`);
    lines.push(`  pass ${(m.passRate * 100).toFixed(0)}%  safety ${(m.safetyRate * 100).toFixed(0)}%  completion ${(m.completionRate * 100).toFixed(0)}%`);
    lines.push(`  SLO (pass>=${report.slo.passRate * 100}%, safety>=${report.slo.safetyRate * 100}%): ${report.passed ? 'MET ✓' : 'FAILED ✗'}`);
    return lines.join('\n');
  }
}
