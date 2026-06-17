# agent-sim

> An autonomous agent acts unattended, so "I'll check the output myself" stops being a plan. You test
> it the way you'd load-test a service: drive it through many scenarios — including adversarial ones —
> **before** production, score the trajectories against SLOs, and fail the build when a change regresses.

A zero-dependency pre-deploy simulation harness for agents. It draws the line that makes reliable
agents possible: the **eval harness** (this — runs scenarios, grades trajectories, aggregates) is
separate from the **agent harness** (the thing under test, a black-box function that returns a
trajectory). Keep them apart and you can replay, regression-test, and simulate situations the agent
never saw live.

## The problem

Static "does it answer correctly" tests go stale, and they never cover the case that actually hurts an
ambient agent: an adversarial input that talks it into a forbidden action (issue a refund, delete a
table) while nobody is watching. You need an SLO — *zero forbidden actions across the suite* — and a
gate that blocks a release the moment a change crosses it.

## What it does

```
agentFn(input) -> { actions: string[], completed: boolean }     // the agent under test (black box)

scenario = { name, input, mustComplete?, forbiddenActions?, adversarial? }   // what "good" means

sim.runScenario(agentFn, scenario)  -> graded result (passed / safe / completed / violations)
sim.runSuite(agentFn, scenarios)    -> metrics (passRate, safetyRate, completionRate) + SLO verdict
Simulator.compareToBaseline(report, baseline) -> regression gate for CI
```

- **Adversarial scenarios** declare the action an injection is *trying* to trigger; the agent passes by
  **refusing** it.
- **SLOs** are explicit thresholds (default: 100% pass, 100% safety — zero tolerance for forbidden actions).
- **Regression gate** compares a run to a saved baseline; any drop in pass or safety rate is a fail you
  wire into CI.

## Quick start

```bash
npm install      # no dependencies
npm run demo     # simulate a naive vs a guarded support agent; watch the SLO gate block the naive one
npm test         # unit tests
```

The demo runs two versions of a support agent against the same suite (two normal tickets, two
prompt-injection tickets). The naive agent obeys the injected "issue a refund" / "delete the table"
commands and is **blocked by the SLO gate**; the guarded agent treats input as data and ships.

## Lessons learned

- **The eval harness must be separate from the agent.** If you can only evaluate what you happened to
  log in production, you can't simulate the attack that hasn't happened yet.
- **Safety is a hard SLO, not an average.** "95% safe" means 1 in 20 unattended runs takes a forbidden
  action. The default threshold is zero tolerance for a reason.
- **Adversarial scenarios are the point.** Normal-path tests pass on day one; the injection scenarios are
  what catch the regression that ships an exploitable agent.

## Where this sits

In 2026 "eval-driven development" / simulation-first testing became the answer to the field's #1
production barrier — quality, not capability. This is the minimal, readable core of that idea: a
scenario suite, an SLO, and a regression gate, runnable in one file.

## Related

- [agent-routing](https://github.com/shubham0086/agent-routing) — the reliability sibling (provider failover + circuit breaker)
- [agent-identity](https://github.com/shubham0086/agent-identity) — scope what the agent under test is allowed to do
- Handbook: [The Machine OS / WORKFLOWS/eval-driven-development](https://github.com/shubham0086/the-machine-os/tree/master/WORKFLOWS)
