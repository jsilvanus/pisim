# pisim

Scenario player for the Pi production ecosystem. It replays timed requests against the **real** services (picomposer, pigateway, pimatrix, ...) so you can test them, including the generative UI, without hardware. The services do not know they are being simulated: they receive ordinary requests, and there is no sim mode or sim flag inside any of them.

Zero dependencies, Node >= 20, ESM.

```bash
# start picomposer locally (npm run dev), then:
node bin/pisim.mjs run scenarios/normal-service.jsonl --out pisim-out
```

Steps with `save` write the response (for example the rendered `/gui/1` page) to `--out`, so each scenario leaves a series of screen snapshots to open in a browser. `--no-timing` ignores `at` and runs the steps back to back.

## Scenario format (JSONL)

```
{"at":3000,"label":"Director advises","target":"picomposer","path":"/api/v1/ingest/event","body":{"type":"advisory","data":{"id":"a1","cutToInput":2}}}
{"at":3100,"target":"picomposer","path":"/gui/1","save":"after-advisory.html"}
```

`at` is ms from start. `method` defaults to POST with a body, else GET. `headers` is optional. `#` lines and blanks are ignored.

## Targets and safety

Targets default to the ecosystem's local ports and can be overridden with `PISIM_TARGET_<NAME>=http://host:port`. A target that is not localhost is refused unless you pass `--allow-remote`, so a scenario cannot act on the real Pi by accident. Exit code 2 means a step failed or answered 4xx/5xx.

## Samples

`scenarios/`: `normal-service`, `operator-takes-over`, `failures` (picomposer ingest events and prompts).

## Not built yet

Fake upstream services (a pigateway or pimatrix stand-in that serves state and SSE) for testing picontrol without a Pi. Unverified against the real Pi.
