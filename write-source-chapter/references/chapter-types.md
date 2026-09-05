# Adapting the chapter shape

Choose the dominant teaching purpose, then borrow only the secondary elements that materially help. Do not force every chapter into an identical table of contents.

Start from the repository's natural explanatory spine. Runtime component architecture is one valid shape, not the universal default.

## Overview and architecture

Lead with the system problem and boundary, then explain layers, components, interfaces, control versus data plane, the main end-to-end flow, and cross-cutting concerns. Defer individual APIs until the reader can place them on the map.

Useful evidence: top-level entry points, public interfaces, design documents, composition roots, deployment manifests, and representative tests.

## Quick start and operations

Organize around an executable path:

`prerequisites → install/build → configure → start → minimal operation → verify → diagnose`

Explain configuration precedence and observable success criteria. Avoid turning commands into an unexplained recipe. Cite build files, CLI definitions, config loaders, and integration tests rather than relying only on README prose.

## API and language bindings

Explain the object model, ownership, errors, threading expectations, and lifecycle before cataloging signatures. When several language layers exist, show the mapping from user call to binding to native implementation. Use tables for semantic comparisons, not as a dump of every method.

## Internal mechanism

Start from invariants and the normal path, then walk through types, state transitions, ownership, concurrency, and failure cleanup. An explicit path is usually clearer:

`Caller → public API → coordinator → state/data structure → backend → completion`

Name important exceptional paths after the normal path is understood.

## Algorithm or transformation pipeline

Lead with the input/output contract and invariant, then explain representations, ordered stages or passes, termination, correctness conditions, and complexity. Trace a representative input through the transformation and separate mathematical guarantees from implementation shortcuts.

Useful evidence: public functions, intermediate representations, rule or pass definitions, property tests, golden cases, and benchmarks with recorded conditions.

## State, event, or user-interface flow

Start from the state model and event sources. Show validation, transition/reducer logic, derived state, effects, rendering or persistence boundaries, and failure/recovery behavior. Do not force an asynchronous backend call chain onto a local state tree when a transition model explains it better.

## Data, schema, or build graph

Explain nodes, dependencies, transformation order, caching/invalidation, artifact ownership, and reproducibility. For declarative repositories, configuration or graph edges may be the primary implementation evidence rather than conventional functions and classes.

## Backend, transport, or protocol

First explain the shared abstraction and dispatch point, then protocol-specific setup, resource registration, request slicing/submission, completion, cleanup, and fallback/failure behavior. Separate properties guaranteed by the common interface from backend-specific behavior.

## Integration, deployment, and configuration

Show process boundaries, external dependencies, ports/endpoints, identity or metadata flow, and startup/shutdown order. Trace configuration values from declaration through parsing and consumption. Distinguish data-plane paths from control-plane operations.

## Performance and tuning

State the question, environment, workload, metric, baseline, result, and limitations. Connect an optimization to the code path it changes. Do not generalize a benchmark beyond its hardware, workload, and revision.

A useful order is:

`method → baseline → observed bottleneck → implementation mechanism → result → limit/trade-off`

## Glossary and reference

Group terms by subsystem or relationship and connect each term to the flows in which it participates. A glossary may use fewer implementation details, but definitions must still be grounded. Do not force architecture diagrams or thought questions when the deliverable is intentionally a compact reference.

## Focused section or revision

Keep the requested scope. Preserve surrounding numbering, terminology, and already-correct evidence. Add a chapter preview, summary, or questions only when the user requested a complete chapter. For revision, repair unsupported claims and stale citations rather than rewriting unrelated prose for stylistic uniformity.
