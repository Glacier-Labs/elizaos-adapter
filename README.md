## Overview
GlacierDB implements a database adapter for the [elizaos](https://elizaos.github.io/eliza/docs/packages/adapters/).

- GlacierDB: Glacier Network is building a programmable, modular and scalable blockchain infrastructure for agents, models and datasets, supercharging AI at scale. [website](https://www.glacier.io/)
- ElizaOS: eliza is a simple, fast, and lightweight AI agent. [website](https://elizaos.github.io/eliza/)


## Prerequisites

Before getting started with Eliza, ensure you have:

- [Node.js 23+](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)
- [pnpm 9+](https://pnpm.io/installation)
- Git for version control
- A code editor ([VS Code](https://code.visualstudio.com/) or [VSCodium](https://vscodium.com) recommended)
- [CUDA Toolkit](https://developer.nvidia.com/cuda-toolkit) (optional, for GPU acceleration)

## Quick Start

0. Install the eliza [guide](https://elizaos.github.io/eliza/docs/quickstart/#installation)



1. Install the GlacierDB dependencies

```
pnpm add @glacier-network/elizaos-adapter @glacier-network/client
```

2. Add the GlacierDB adapter to the agent runtime.

```diff
--- a/agent/src/index.ts
+++ b/agent/src/index.ts
@@ -7,6 +7,7 @@ import { LensAgentClient } from "@elizaos/client-lens";
 import { SlackClientInterface } from "@elizaos/client-slack";
 import { TelegramClientInterface } from "@elizaos/client-telegram";
 import { TwitterClientInterface } from "@elizaos/client-twitter";
+import { GlacierDBDatabaseAdapter } from "@glacier-network/elizaos-adapter";
 import {
     AgentRuntime,
     CacheManager,
@@ -677,8 +678,12 @@ async function startAgent(
             fs.mkdirSync(dataDir, { recursive: true });
         }
 
-        db = initializeDatabase(dataDir) as IDatabaseAdapter &
-            IDatabaseCacheAdapter;
+        db = new GlacierDBDatabaseAdapter({
+            endpoint: process.env.GLACIERDB_ENDPOINT!,
+            namespace: process.env.GLACIERDB_NAMESPACE!,
+            dataset: process.env.GLACIERDB_DATASET!,
+            privateKey: process.env.GLACIERDB_PRIVATE_KEY!,
+        });
 
         await db.init();
```

3. Start your agent

```
pnpm start --character="characters/trump.character.json"
```

## Dev

```
npx tsup --format esm src/init.ts
```
