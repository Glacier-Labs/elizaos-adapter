## Overview
GlacierDB implements a database adapter for the [elizaos](https://elizaos.github.io/eliza/docs/packages/adapters/).

- GlacierDB: Glacier Network is building a programmable, modular and scalable blockchain infrastructure for agents, models and datasets, supercharging AI at scale. [website](https://www.glacier.io/)
- ElizaOS: eliza is a simple, fast, and lightweight AI agent. [website](https://elizaos.github.io/eliza/)

## Installation


```
pnpm add @glacier-network/elizaos-adapter @glacier-network/client
```

## Quick Start

```
import { GlacierDBDatabaseAdapter } from "@glacier-network/elizaos-adapter";

const db = new GlacierDBDatabaseAdapter({
    endpoint: process.env.GLACIERDB_ENDPOINT!,
    namespace: process.env.GLACIERDB_NAMESPACE!,
    dataset: process.env.GLACIERDB_DATASET!,
    privateKey: process.env.GLACIERDB_PRIVATE_KEY!,
});
```
 

