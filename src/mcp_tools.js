/**
 * MCP tool definitions + dispatch for agent-sim (pre-deploy evaluation harness).
 *
 * Kept separate from the stdio server wiring (mcp_server.js) so the tool logic is
 * unit-testable without spawning a transport. Pure: handleTool() takes a name + args
 * and returns a plain object (or throws). No SDK imports here.
 *
 * ADAPTER NOTE: Simulator.runSuite(agentFn, scenarios) takes a LIVE function, which can't
 * cross an MCP boundary. So this spoke grades RECORDED agent runs: each scenario carries the
 * trajectory the agent actually produced ({actions, completed}). We replay those trajectories
 * through the real runSuite by handing it a closure that returns each scenario's recorded
 * trajectory in order — reusing the engine's exact grading + SLO + aggregation logic.
 *
 * Tools:
 *   - evaluate_run   : grade recorded runs against scenarios + SLO -> metrics + scorecard
 *   - compare_baseline : regression gate (any drop in pass/safety vs a baseline)
 */
import { Simulator } from './Simulator.js';

export const TOOLS = [
  {
    name: 'evaluate_run',
    description:
      'Grade recorded agent runs against adversarial/functional scenarios and an SLO. Each scenario ' +
      'carries the trajectory the agent produced (actions + completed). Returns pass/safety/completion ' +
      'rates, per-scenario results, a scorecard, and whether the SLO was met. Use before shipping an ' +
      'agent change to catch safety regressions (e.g. it took a forbidden action).',
    inputSchema: {
      type: 'object',
      properties: {
        scenarios: {
          type: 'array',
          description: 'Scenarios, each with the recorded trajectory the agent produced.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Scenario name.' },
              mustComplete: { type: 'boolean', description: 'Whether the agent had to complete the task.' },
              forbiddenActions: { type: 'array', items: { type: 'string' }, description: 'Actions the agent must NOT take.' },
              adversarial: { type: 'boolean', description: 'Whether this scenario baits unsafe behavior.' },
              trajectory: {
                type: 'object',
                description: 'What the agent actually did.',
                properties: {
                  actions: { type: 'array', items: { type: 'string' }, description: 'Actions the agent took.' },
                  completed: { type: 'boolean', description: 'Whether the agent completed the task.' },
                  output: { description: 'Optional final output.' },
                },
              },
            },
            required: ['name'],
          },
        },
        slo: {
          type: 'object',
          description: 'SLO thresholds the suite must meet (fractions 0-1).',
          properties: {
            passRate: { type: 'number', description: 'Min fraction of scenarios that must pass (default 1).' },
            safetyRate: { type: 'number', description: 'Min fraction free of forbidden actions (default 1).' },
          },
        },
      },
      required: ['scenarios'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'compare_baseline',
    description:
      'Regression gate: compare a run\'s metrics to a saved baseline. Any drop in pass rate or safety ' +
      'rate is a regression. Wire this into CI to block a release that made the agent less safe.',
    inputSchema: {
      type: 'object',
      properties: {
        metrics: {
          type: 'object',
          description: 'Current metrics (from evaluate_run.metrics).',
          properties: {
            passRate: { type: 'number' },
            safetyRate: { type: 'number' },
          },
          required: ['passRate', 'safetyRate'],
        },
        baseline: {
          type: 'object',
          description: 'Baseline metrics from a previous good run.',
          properties: {
            passRate: { type: 'number' },
            safetyRate: { type: 'number' },
          },
          required: ['passRate', 'safetyRate'],
        },
      },
      required: ['metrics', 'baseline'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'sim_info',
    description:
      'Lightweight introspection: returns this spoke name, version, and the list of available tool names. ' +
      'Read-only; takes no arguments.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

// Spoke identity, surfaced by sim_info. Kept in sync with package.json + mcp_server.js.
export const SPOKE = { name: 'agent-sim', version: '1.0.0' };

export async function handleTool(name, args = {}) {
  switch (name) {
    case 'evaluate_run': {
      const scenarios = args.scenarios;
      if (!Array.isArray(scenarios) || scenarios.length === 0) {
        throw new Error('evaluate_run requires a non-empty "scenarios" array');
      }
      const sim = new Simulator({ slo: args.slo || {} });

      // Replay recorded trajectories through the real grader, in scenario order.
      let i = 0;
      const replayFn = () => {
        const sc = scenarios[i++];
        return sc.trajectory || { actions: [], completed: false };
      };

      const report = await sim.runSuite(replayFn, scenarios);
      return { ...report, scorecard: Simulator.format(report) };
    }
    case 'compare_baseline': {
      if (!args.metrics || !args.baseline) {
        throw new Error('compare_baseline requires "metrics" and "baseline"');
      }
      return Simulator.compareToBaseline({ metrics: args.metrics }, args.baseline);
    }
    case 'sim_info': {
      return { name: SPOKE.name, version: SPOKE.version, tools: TOOLS.map((t) => t.name) };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
