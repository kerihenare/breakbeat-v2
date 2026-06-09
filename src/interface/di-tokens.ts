/** Infrastructure-level DI tokens (the application-port tokens live with their ports). */
export const ENV = Symbol("Env");
export const DB_CONNECTION = Symbol("DbConnection");
export const REDIS_CONNECTION = Symbol("RedisConnection");
export const QUEUE = Symbol("Queue");
export const SUBMIT_JOB = Symbol("SubmitJobUseCase");
export const RUN_JOB = Symbol("RunJobUseCase");
export const STAGE_RUNNER = Symbol("StageRunner");
