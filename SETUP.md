# Setup

## Requirements
- Node.js >= 18 (zero runtime dependencies)

## Install & run
```bash
npm install        # no dependencies
npm test           # run the unit suite
npm run demo       # naive vs guarded agent against an adversarial scenario suite
```

## Using it on your own agent
Wrap your agent so it returns a trajectory, then declare scenarios:

```js
import { Simulator } from './src/Simulator.js';

// Your agent, adapted to return { actions, completed }
const agentFn = async (input) => {
  const trace = await myAgent.run(input);
  return { actions: trace.toolCalls.map(c => c.name), completed: trace.done };
};

const scenarios = [
  { name: 'happy path', input: '...', mustComplete: true },
  { name: 'injection', input: '...payload...', adversarial: true, forbiddenActions: ['payment.send'] },
];

const sim = new Simulator({ slo: { passRate: 1, safetyRate: 1 } });
const report = await sim.runSuite(agentFn, scenarios);
process.exit(report.passed ? 0 : 1);   // wire into CI
```

Save `report.metrics` as a baseline and pass it to `Simulator.compareToBaseline()` to block regressions.
