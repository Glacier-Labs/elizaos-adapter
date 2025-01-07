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

In this guide, we'll walk you through the process of setting up Eliza and GlacierDB. 

### Install the eliza [guide](https://elizaos.github.io/eliza/docs/quickstart/#installation)

Please be sure to check what the [latest available stable version tag](https://github.com/elizaos/eliza/tags) is.

1. Clone the repository

```bash
git clone https://github.com/elizaos/eliza.git
```

2. Enter directory

```bash
cd eliza
```

3. Switch to latest tagged release

```bash
    # Checkout the latest release
    # This project iterates fast, so we recommend checking out the latest release
    git checkout $(git describe --tags --abbrev=0)
```

4. Install dependencies (on initial run)

```bash
pnpm install --no-frozen-lockfile
```


### Install the GlacierDB dependencies

```
pnpm add @glacier-network/elizaos-adapter @glacier-network/client
```

### Add the GlacierDB adapter to the agent runtime.

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

### Add configurations to the `.env` file

```
# GlacierDB For DEMO!!!!
GLACIERDB_ENDPOINT=https://greenfield.onebitdev.com/glacier-gateway/
GLACIERDB_NAMESPACE=elizademo
GLACIERDB_DATASET=demo2
GLACIERDB_PRIVATE_KEY=0x4eba9156493bb84f988c9ec0765b28063841bfcb434a3a55b07409cb1237697f
```

DEMO dataset: https://scan.bnb.glacier.io/dataset?namespace=elizademo&dataset=demo2

### Start your agent

```
pnpm start --character="characters/trump.character.json"
pnpm start:client
```

## Development

```
cd ./
npx tsup --format esm src/init.ts
node dist/init.js

cd ./
pnpm link --global 
pnpm install
pnpm run build

cd ../aliza/agent
pnpm link @glacier-network/elizaos-adapter
```
