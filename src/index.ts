import { GlacierClient } from '@glacier-network/client';
import { v4 as uuidv4 } from "uuid";
import {
    Account,
    Actor,
    GoalStatus,
    type Goal,
    type Memory,
    type Relationship,
    type UUID,
    type IDatabaseCacheAdapter,
    Participant,
    elizaLogger,
    getEmbeddingConfig,
    DatabaseAdapter,
} from "@elizaos/core";

export class GlacierDBDatabaseAdapter
    extends DatabaseAdapter<GlacierClient>
    implements IDatabaseCacheAdapter {
    private _db: any;
    private client: GlacierClient
    private namespace: string;
    private dataset: string;
    private readonly maxRetries: number = 3;
    private readonly baseDelay: number = 1000; // 1 second
    private readonly maxDelay: number = 10000; // 10 seconds
    private readonly jitterMax: number = 1000; // 1 second

    constructor(connectionConfig: any) {
        super({
            failureThreshold: 5,
            resetTimeout: 60000,
            halfOpenMaxAttempts: 3,
        });
        this.client = new GlacierClient(connectionConfig.endpoint, {
            privateKey: connectionConfig.privateKey,
        });
        this.namespace = connectionConfig.namespace;
        this.dataset = connectionConfig.dataset
        this._db = this.client.namespace(connectionConfig.namespace).dataset(connectionConfig.dataset);

        this.setupProcessErrorHandling();
    }

    private setupProcessErrorHandling() {
        process.on("SIGINT", async () => {
            await this.cleanup();
            process.exit(0);
        });

        process.on("SIGTERM", async () => {
            await this.cleanup();
            process.exit(0);
        });

        process.on("beforeExit", async () => {
            await this.cleanup();
        });
    }

    private async withDatabase<T>(
        operation: () => Promise<T>,
        context: string
    ): Promise<T> {
        return this.withCircuitBreaker(async () => {
            return this.withRetry(operation);
        }, context);
    }

    private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
        let lastError: Error = new Error("Unknown error");

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error as Error;

                if (attempt < this.maxRetries) {
                    const backoffDelay = Math.min(
                        this.baseDelay * Math.pow(2, attempt - 1),
                        this.maxDelay
                    );

                    const jitter = Math.random() * this.jitterMax;
                    const delay = backoffDelay + jitter;

                    elizaLogger.warn(
                        `Database operation failed (attempt ${attempt}/${this.maxRetries}):`,
                        {
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                            nextRetryIn: `${(delay / 1000).toFixed(1)}s`,
                        }
                    );

                    await new Promise((resolve) => setTimeout(resolve, delay));
                } else {
                    elizaLogger.error("Max retry attempts reached:", {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        totalAttempts: attempt,
                    });
                    throw error instanceof Error
                        ? error
                        : new Error(String(error));
                }
            }
        }

        throw lastError;
    }

    private async handleConnectionError(error: Error) {
        elizaLogger.error("Connection error occurred, attempting to reconnect", {
            error: error.message,
        });
    }

    async query<R = any, I = any[]>(
        queryTextOrConfig: string | any,
        values?: any[]
    ): Promise<R> {
        return this.withDatabase(async () => {
            const collection = this._db.collection(queryTextOrConfig);
            return await collection.find(values).toArray() as R;
        }, "query");
    }
    async initOnce() {
        await this.client.createNamespace(this.namespace)
        await this.client.namespace(this.namespace).createDataset(this.dataset)
        await this._db.createCollection("rooms", {})
        await this._db.createCollection("goals", {})
        await this._db.createCollection("participants", {})
        await this._db.createCollection("memories", {
            title: "memories",
            type: "object",
            properties: {
                roomId: {
                    type: "string",
                    vectorIndexOption: {
                        "type": "token",
                    },
                },
                agentId: {
                    type: "string",
                    vectorIndexOption: {
                        "type": "token",
                    },
                },
                type: {
                    type: "string",
                    vectorIndexOption: {
                        "type": "token",
                    },
                },
                content: {
                    type: "string",
                },
                embedding: {
                    type: "string",
                    vectorIndexOption: {
                        "type": "knnVector",
                        "dimensions": 384,
                        "similarity": "euclidean",
                    },
                }
            }
        })
        await this._db.createCollection("relationships", {})
        await this._db.createCollection("accounts", {})
        await this._db.createCollection("cache", {})
        await this._db.createCollection("logs", {})

        this._db.collection("accounts").insertOne({
            id: "00000000-0000-0000-0000-000000000000",
            name: "glacierdb",
            username: "glacierdb",
            email: "info@glacier.io",
            avatarUrl: "",
            details: JSON.stringify({}),
            createdAt: Date.now(),
        })
        this._db.collection("rooms").insertOne({
            id: "00000000-0000-0000-0000-000000000000",
            createdAt: Date.now(),
        })
        this._db.collection("participants").insertOne({
            id: "00000000-0000-0000-0000-000000000000",
            userId: "00000000-0000-0000-0000-000000000000",
            roomId: "00000000-0000-0000-0000-000000000000",
            createdAt: Date.now(),
        })
    }

    async init() {
    }

    async close() {
    }
    async cleanup(): Promise<void> {
        try {
            elizaLogger.info("Database connection closed");
        } catch (error) {
            elizaLogger.error("Error closing database connection:", error);
        }
    }

    async getRoom(roomId: UUID): Promise<UUID | null> {
        return this.withDatabase(async () => {
            const rooms = await this._db.collection("rooms").find({ id: roomId }).limit(1).toArray();
            const room = rooms && rooms.length > 0 ? rooms[0] : null;
            return room ? room.id.toString() : null;
        }, "getRoom");
    }

    async getParticipantsForAccount(userId: UUID): Promise<Participant[]> {
        return this.withDatabase(async () => {
            return await this._db.collection("participants").find({ userId }).toArray() as Participant[];
        }, "getParticipantsForAccount");
    }

    async getParticipantUserState(
        roomId: UUID,
        userId: UUID
    ): Promise<"FOLLOWED" | "MUTED" | null> {
        return this.withDatabase(async () => {
            const participants = await this._db.collection("participants").find({ roomId, userId }).limit(1).toArray();
            return participants && participants.length > 0 ? participants[0].userState : null;
        }, "getParticipantUserState");
    }

    async getMemoriesByRoomIds(params: {
        roomIds: UUID[];
        agentId?: UUID;
        tableName: string;
    }): Promise<Memory[]> {
        return this.withDatabase(async () => {
            if (params.roomIds.length === 0) return [];
            const query: any = { roomId: { $in: params.roomIds }, type: params.tableName };
            if (params.agentId) query.agentId = params.agentId;

            const memories = await this._db.collection("memories").find(query).toArray();
            return memories.map((memory) => ({
                ...memory,
                content: typeof memory.content === "string" ? JSON.parse(memory.content) : memory.content,
            }));
        }, "getMemoriesByRoomIds");
    }

    async setParticipantUserState(
        roomId: UUID,
        userId: UUID,
        state: "FOLLOWED" | "MUTED" | null
    ): Promise<void> {
        return this.withDatabase(async () => {
            await this._db.collection("participants").updateOne(
                { roomId, userId },
                { userState: state }
            );
        }, "setParticipantUserState");
    }

    async getParticipantsForRoom(roomId: UUID): Promise<UUID[]> {
        return this.withDatabase(async () => {
            const participants = await this._db.collection("participants").find({ roomId }).toArray();
            return participants.map(participant => participant.userId);
        }, "getParticipantsForRoom");
    }

    async getAccountById(userId: UUID): Promise<Account | null> {
        return this.withDatabase(async () => {
            const accounts = await this._db.collection("accounts").find({ id: userId }).limit(1).toArray();
            const account = accounts && accounts.length > 0 ? accounts[0] : null;
            if (!account) {
                elizaLogger.debug("Account not found:", { userId });
                return null;
            }

            return {
                ...account,
                details: typeof account.details === "string" ? JSON.parse(account.details) : account.details,
            };
        }, "getAccountById");
    }

    async createAccount(account: Account): Promise<boolean> {
        return this.withDatabase(async () => {
            try {
                const accountId = account.id ?? uuidv4();
                await this._db.collection("accounts").insertOne({
                    id: accountId,
                    name: account.name,
                    username: account.username || "",
                    email: account.email || "",
                    avatarUrl: account.avatarUrl || "",
                    details: JSON.stringify(account.details),
                });
                elizaLogger.debug("Account created successfully:", { accountId });
                return true;
            } catch (error) {
                elizaLogger.error("Error creating account:", {
                    error: error instanceof Error ? error.message : String(error),
                    accountId: account.id,
                    name: account.name,
                });
                return false;
            }
        }, "createAccount");
    }

    async getActorById(params: { roomId: UUID }): Promise<Actor[]> {
        return this.withDatabase(async () => {
            const participants = await this.getParticipantsForRoom(params.roomId)
            const query: any = { userId: { $in: participants } };

            const actors = await this._db.collection("accounts").find(query).toArray();

            elizaLogger.debug("Retrieved actors:", {
                roomId: params.roomId,
                actorCount: actors.length,
            });

            return actors.map((actor) => {
                try {
                    return {
                        ...actor,
                        details: typeof actor.details === "string" ? JSON.parse(actor.details) : actor.details,
                    };
                } catch (error) {
                    elizaLogger.warn("Failed to parse actor details:", {
                        actorId: actor._id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    return {
                        ...actor,
                        details: {},
                    };
                }
            });
        }, "getActorById").catch((error) => {
            elizaLogger.error("Failed to get actors:", {
                roomId: params.roomId,
                error: error.message,
            });
            throw error;
        });
    }

    async getMemoryById(id: UUID): Promise<Memory | null> {
        return this.withDatabase(async () => {
            const memorys = await this._db.collection("memories").find({ id: id }).limit(1).toArray();
            const memory = memorys && memorys.length > 0 ? memorys[0] : null;
            if (!memory) return null;

            return {
                ...memory,
                content: typeof memory.content === "string" ? JSON.parse(memory.content) : memory.content,
            };
        }, "getMemoryById");
    }

    async createMemory(memory: Memory, tableName: string): Promise<void> {
        return this.withDatabase(async () => {
            elizaLogger.debug("MongoDBAdapter createMemory:", {
                memoryId: memory.id,
                embeddingLength: memory.embedding?.length,
                contentLength: memory.content?.text?.length,
            });
            let isUnique = true;
            if (memory.embedding) {
                const similarMemories = await this.searchMemoriesByEmbedding(
                    memory.embedding,
                    {
                        tableName,
                        roomId: memory.roomId,
                        match_threshold: 0.95,
                        count: 1,
                    }
                );
                isUnique = similarMemories.length === 0;
            }

            await this._db.collection("memories").insertOne({
                id: memory.id ?? uuidv4(),
                type: tableName,
                content: JSON.stringify(memory.content),
                embedding: memory.embedding ? memory.embedding : null,
                userId: memory.userId,
                roomId: memory.roomId,
                agentId: memory.agentId ? memory.agentId : null,
                unique: memory.unique ?? isUnique,
                createdAt: Date.now(),
            });
        }, "createMemory");
    }

    async searchMemories(params: {
        tableName: string;
        agentId: UUID;
        roomId: UUID;
        embedding: number[];
        match_threshold: number;
        match_count: number;
        unique: boolean;
    }): Promise<Memory[]> {
        return await this.searchMemoriesByEmbedding(params.embedding, {
            match_threshold: params.match_threshold,
            count: params.match_count,
            agentId: params.agentId,
            roomId: params.roomId,
            unique: params.unique,
            tableName: params.tableName,
        });
    }

    async getMemories(params: {
        roomId: UUID;
        count?: number;
        unique?: boolean;
        tableName: string;
        agentId?: UUID;
        start?: number;
        end?: number;
    }): Promise<Memory[]> {
        if (!params.tableName) throw new Error("tableName is required");
        if (!params.roomId) throw new Error("roomId is required");

        return this.withDatabase(async () => {
            const query: any = { type: params.tableName, roomId: params.roomId };
            if (params.start) query.createdAt = { $gte: params.start };
            if (params.end) query.createdAt = { ...query.createdAt, $lte: params.end };
            if (params.unique) query.unique = true;
            if (params.agentId) query.agentId = params.agentId;
            if (params.count > 20) {
                params.count = 20;
            }
            const memories = await this._db.collection("memories").find(query).sort({ createdAt: -1 }).limit(params.count).toArray();
            return memories.map((memory) => ({
                ...memory,
                content: typeof memory.content === "string" ? JSON.parse(memory.content) : memory.content,
            }));
        }, "getMemories");
    }

    async getGoals(params: {
        roomId: UUID;
        userId?: UUID | null;
        onlyInProgress?: boolean;
        count?: number;
    }): Promise<Goal[]> {
        return this.withDatabase(async () => {
            const query: any = { roomId: params.roomId };
            if (params.userId) query.userId = params.userId;
            if (params.onlyInProgress) query.status = "IN_PROGRESS";

            const goals = await this._db.collection("goals").find(query).limit(params.count).toArray();
            return goals.map((goal) => ({
                ...goal,
                objectives: typeof goal.objectives === "string" ? JSON.parse(goal.objectives) : goal.objectives,
            }));
        }, "getGoals");
    }

    async updateGoal(goal: Goal): Promise<void> {
        return this.withDatabase(async () => {
            try {
                await this._db.collection("goals").updateOne(
                    { id: goal.id },
                    {
                        name: goal.name,
                        status: goal.status,
                        objectives: JSON.stringify(goal.objectives),
                    }
                );
            } catch (error) {
                elizaLogger.error("Failed to update goal:", {
                    goalId: goal.id,
                    error: error instanceof Error ? error.message : String(error),
                    status: goal.status,
                });
                throw error;
            }
        }, "updateGoal");
    }

    async createGoal(goal: Goal): Promise<void> {
        return this.withDatabase(async () => {
            await this._db.collection("goals").insertOne({
                id: goal.id ?? uuidv4(),
                roomId: goal.roomId,
                userId: goal.userId,
                name: goal.name,
                status: goal.status,
                objectives: JSON.stringify(goal.objectives),
            });
        }, "createGoal");
    }

    async removeGoal(goalId: UUID): Promise<void> {
        if (!goalId) throw new Error("Goal ID is required");

        return this.withDatabase(async () => {
            try {
                const result = await this._db.collection("goals").deleteOne({ id: goalId });

                elizaLogger.debug("Goal removal attempt:", {
                    goalId,
                    removed: result.deletedCount > 0,
                });
            } catch (error) {
                elizaLogger.error("Failed to remove goal:", {
                    goalId,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        }, "removeGoal");
    }

    async createRoom(roomId?: UUID): Promise<UUID> {
        return this.withDatabase(async () => {
            const newRoomId = roomId || uuidv4();
            await this._db.collection("rooms").insertOne({ id: newRoomId });
            return newRoomId as UUID;
        }, "createRoom");
    }

    async removeRoom(roomId: UUID): Promise<void> {
        if (!roomId) throw new Error("Room ID is required");

        return this.withDatabase(async () => {
            try {
                const result = await this._db.collection("rooms").deleteOne({ id: roomId });

                elizaLogger.debug("Room and related data removed successfully:", {
                    roomId,
                    removed: result.deletedCount > 0,
                });
            } catch (error) {
                elizaLogger.error("Failed to remove room:", {
                    roomId,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        }, "removeRoom");
    }

    async createRelationship(params: {
        userA: UUID;
        userB: UUID;
    }): Promise<boolean> {
        // Input validation
        if (!params.userA || !params.userB) {
            throw new Error("userA and userB are required");
        }

        return this.withDatabase(async () => {
            try {
                const relationshipId = uuidv4();
                await this._db.collection("relationships").insertOne({
                    id: relationshipId,
                    userA: params.userA,
                    userB: params.userB,
                    userId: params.userA,
                });

                elizaLogger.debug("Relationship created successfully:", {
                    relationshipId,
                    userA: params.userA,
                    userB: params.userB,
                });

                return true;
            } catch (error) {
                elizaLogger.error("Failed to create relationship:", {
                    userA: params.userA,
                    userB: params.userB,
                    error: error instanceof Error ? error.message : String(error),
                });
                return false;
            }
        }, "createRelationship");
    }

    async getRelationship(params: {
        userA: UUID;
        userB: UUID;
    }): Promise<Relationship | null> {
        if (!params.userA || !params.userB) {
            throw new Error("userA and userB are required");
        }

        return this.withDatabase(async () => {
            try {
                const relationships = await this._db.collection("relationships").find({
                    $or: [
                        { userA: params.userA, userB: params.userB },
                        { userA: params.userB, userB: params.userA },
                    ],
                }).limit(1).toArray();
                const relationship = relationships && relationships.length > 0 ? relationships[0] : null;
                if (relationship) {
                    elizaLogger.debug("Relationship found:", {
                        relationshipId: relationship._id,
                        userA: params.userA,
                        userB: params.userB,
                    });
                    return relationship;
                }

                elizaLogger.debug("No relationship found between users:", {
                    userA: params.userA,
                    userB: params.userB,
                });
                return null;
            } catch (error) {
                elizaLogger.error("Error fetching relationship:", {
                    userA: params.userA,
                    userB: params.userB,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        }, "getRelationship");
    }

    async getRelationships(params: { userId: UUID }): Promise<Relationship[]> {
        if (!params.userId) {
            throw new Error("userId is required");
        }

        return this.withDatabase(async () => {
            try {
                const relationships = await this._db.collection("relationships").find({
                    $or: [
                        { userA: params.userId },
                        { userB: params.userId },
                    ],
                }).sort({ createdAt: -1 }).toArray();

                elizaLogger.debug("Retrieved relationships:", {
                    userId: params.userId,
                    count: relationships.length,
                });

                return relationships;
            } catch (error) {
                elizaLogger.error("Failed to fetch relationships:", {
                    userId: params.userId,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        }, "getRelationships");
    }

    async getCachedEmbeddings(_opts: {
        query_table_name: string;
        query_threshold: number;
        query_input: string;
        query_field_name: string;
        query_field_sub_name: string;
        query_match_count: number;
    }): Promise<{ embedding: number[]; levenshtein_score: number }[]> {
        return [];
    }

    async log(params: {
        body: { [key: string]: unknown };
        userId: UUID;
        roomId: UUID;
        type: string;
    }): Promise<void> {
        // Input validation
        if (!params.userId) throw new Error("userId is required");
        if (!params.roomId) throw new Error("roomId is required");
        if (!params.type) throw new Error("type is required");
        if (!params.body || typeof params.body !== "object") {
            throw new Error("body must be a valid object");
        }

        return this.withDatabase(async () => {
            try {
                const logId = uuidv4(); // Generate ID for tracking
                await this._db.collection("logs").insertOne({
                    id: logId,
                    body: JSON.stringify(params.body), // Ensure body is stringified
                    userId: params.userId,
                    roomId: params.roomId,
                    type: params.type,
                    createdAt: Date.now(),
                });

                elizaLogger.debug("Log entry created:", {
                    logId,
                    type: params.type,
                    roomId: params.roomId,
                    userId: params.userId,
                    bodyKeys: Object.keys(params.body),
                });
            } catch (error) {
                elizaLogger.error("Failed to create log entry:", {
                    error:
                        error instanceof Error ? error.message : String(error),
                    type: params.type,
                    roomId: params.roomId,
                    userId: params.userId,
                });
                throw error;
            }
        }, "log");
    }

    async searchMemoriesByEmbedding(
        embedding: number[],
        params: {
            match_threshold?: number;
            count?: number;
            agentId?: UUID;
            roomId?: UUID;
            unique?: boolean;
            tableName: string;
        }
    ): Promise<Memory[]> {
        return this.withDatabase(async () => {
            elizaLogger.debug("Incoming vector:", {
                length: embedding.length,
                sample: embedding.slice(0, 5),
                isArray: Array.isArray(embedding),
                allNumbers: embedding.every((n) => typeof n === "number"),
            });

            // Validate embedding dimension
            if (embedding.length !== getEmbeddingConfig().dimensions) {
                throw new Error(
                    `Invalid embedding dimension: expected ${getEmbeddingConfig().dimensions}, got ${embedding.length}`
                );
            }

            // Ensure vector is properly formatted
            const cleanVector = embedding.map((n) => {
                if (!Number.isFinite(n)) return 0;
                // Limit precision to avoid floating point issues
                return Number(n.toFixed(6));
            });

            elizaLogger.debug("Vector debug:", {
                originalLength: embedding.length,
                cleanLength: cleanVector.length,
                sampleStr: cleanVector.slice(0, 100).join(","),
            });

            const query: any = {
                'type': params.tableName,
                'numCandidates': params.count,
                'vectorPath': 'embedding',
                'queryVector': cleanVector,
            }

            if (params.agentId) query.agentId = params.agentId;
            if (params.roomId) query.roomId = params.roomId;


            const memories = await this._db.collection("memories").find(query).limit(params.count).toArray();
            return memories.map((memory) => ({
                ...memory,
                content: typeof memory.content === "string" ? JSON.parse(memory.content) : memory.content,
            }));
        }, "searchMemoriesByEmbedding");
    }

    async addParticipant(userId: UUID, roomId: UUID): Promise<boolean> {
        return this.withDatabase(async () => {
            try {
                await this._db.collection("participants").insertOne({
                    id: uuidv4(),
                    userId: userId,
                    roomId: roomId,
                });
                return true;
            } catch (error) {
                console.log("Error adding participant", error);
                return false;
            }
        }, "addParticipant");
    }

    async removeParticipant(userId: UUID, roomId: UUID): Promise<boolean> {
        return this.withDatabase(async () => {
            try {
                await this._db.collection("participants").deleteOne({
                    userId: userId,
                    roomId: roomId,
                });
                return true;
            } catch (error) {
                console.log("Error removing participant", error);
                return false;
            }
        }, "removeParticipant");
    }

    async updateGoalStatus(params: {
        goalId: UUID;
        status: GoalStatus;
    }): Promise<void> {
        return this.withDatabase(async () => {
            await this._db.collection("goals").updateOne(
                { id: params.goalId },
                { status: params.status }
            );
        }, "updateGoalStatus");
    }

    async removeMemory(memoryId: UUID, tableName: string): Promise<void> {
        return this.withDatabase(async () => {
            await this._db.collection("memories").deleteOne({
                id: memoryId,
                type: tableName,
            });
        }, "removeMemory");
    }

    async removeAllMemories(roomId: UUID, tableName: string): Promise<void> {
        return this.withDatabase(async () => {
            const memos = await this._db.collection("memories").find({ roomId: roomId }).toArray()
            for (let index = 0; index < memos.length; index++) {
                const mem = memos[index];
                await this._db.collection("memories").deleteOne({
                    id: mem.id,
                    type: tableName,
                });
            }
        }, "removeAllMemories");
    }

    async countMemories(
        roomId: UUID,
        unique = true,
        tableName = ""
    ): Promise<number> {
        if (!tableName) throw new Error("tableName is required");

        return this.withDatabase(async () => {
            const query: any = { type: tableName, roomId: roomId };
            if (unique) query.unique = true;

            const count = await this._db.collection("memories").find(query).toArray().length;
            return count;
        }, "countMemories");
    }

    async removeAllGoals(roomId: UUID): Promise<void> {
        return this.withDatabase(async () => {
            const goals = await this._db.collection("goals").find({ roomId: roomId }).toArray()
            for (let index = 0; index < goals.length; index++) {
                const goal = goals[index];
                await this._db.collection("goals").deleteOne({
                    id: goal.id,
                });
            }

        }, "removeAllGoals");
    }

    async getRoomsForParticipant(userId: UUID): Promise<UUID[]> {
        return this.withDatabase(async () => {
            const rooms = await this._db.collection("participants").find({ userId: userId }).toArray();
            return rooms.map(room => room.roomId.toString());
        }, "getRoomsForParticipant");
    }

    async getRoomsForParticipants(userIds: UUID[]): Promise<UUID[]> {
        return this.withDatabase(async () => {
            const rooms = await this._db.collection("participants").find({ userId: { $in: userIds } }).toArray();
            return Array.from(new Set(rooms.map(room => room.roomId.toString())));
        }, "getRoomsForParticipants");
    }

    async getActorDetails(params: { roomId: string }): Promise<Actor[]> {
        if (!params.roomId) {
            throw new Error("roomId is required");
        }

        return this.withDatabase(async () => {
            try {
                const participants = await this._db.collection("participants").find({ roomId: params.roomId }).toArray();
                const query: any = { userId: { $in: participants } };
                const actors = await this._db.collection("accounts").find(query).toArray();

                elizaLogger.debug("Retrieved actor details:", {
                    roomId: params.roomId,
                    actorCount: actors.length,
                });

                return actors.map((actor) => {
                    try {
                        return {
                            ...actor,
                            details: typeof actor.details === "string" ? JSON.parse(actor.details) : actor.details,
                        };
                    } catch (parseError) {
                        elizaLogger.warn("Failed to parse actor details:", {
                            actorId: actor._id,
                            error: parseError instanceof Error ? parseError.message : String(parseError),
                        });
                        return {
                            ...actor,
                            details: {}, // Fallback to empty object if parsing fails
                        };
                    }
                });
            } catch (error) {
                elizaLogger.error("Failed to fetch actor details:", {
                    roomId: params.roomId,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw new Error(`Failed to fetch actor details: ${error instanceof Error ? error.message : String(error)}`);
            }
        }, "getActorDetails");
    }

    async getCache(params: {
        key: string;
        agentId: UUID;
    }): Promise<string | undefined> {
        return this.withDatabase(async () => {
            try {
                const cacheEntrys = await this._db.collection("cache").find({
                    key: params.key,
                    agentId: params.agentId,
                }).limit(1).toArray();
                const cacheEntry = cacheEntrys && cacheEntrys.length > 0 ? cacheEntrys[0] : null;
                return cacheEntry?.value;
            } catch (error) {
                elizaLogger.error("Error fetching cache", {
                    error: error instanceof Error ? error.message : String(error),
                    key: params.key,
                    agentId: params.agentId,
                });
                return undefined;
            }
        }, "getCache");
    }

    async setCache(params: {
        key: string;
        agentId: UUID;
        value: string;
    }): Promise<boolean> {
        return this.withDatabase(async () => {
            try {
                const cache = await this.getCache(params);
                if (cache) {
                    await this._db.collection("cache").updateOne(
                        { key: params.key, agentId: params.agentId },
                        { value: params.value, createdAt: Date.now() },
                    );
                    return true;
                }
                await this._db.collection("cache").insertOne({
                    key: params.key,
                    agentId: params.agentId,
                    value: params.value,
                    createdAt: Date.now(),
                });
                return true;
            } catch (error) {
                elizaLogger.error("Error setting cache", {
                    error: error instanceof Error ? error.message : String(error),
                    key: params.key,
                    agentId: params.agentId,
                });
                return false;
            }
        }, "setCache");
    }

    async deleteCache(params: {
        key: string;
        agentId: UUID;
    }): Promise<boolean> {
        return this.withDatabase(async () => {
            try {
                await this._db.collection("cache").deleteOne({
                    key: params.key,
                    agentId: params.agentId,
                });
                return true;
            } catch (error) {
                elizaLogger.error("Error deleting cache", {
                    error: error instanceof Error ? error.message : String(error),
                    key: params.key,
                    agentId: params.agentId,
                });
                return false;
            }
        }, "deleteCache");
    }
}
