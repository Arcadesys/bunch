import { z } from "zod";
import { uuidSchema } from "./contracts";
export const nativeHostWriteSchema=z.object({requestId:uuidSchema,alterId:uuidSchema,expectedVersion:z.number().int().positive().nullable()}).strict();
export type NativeHostWrite=z.infer<typeof nativeHostWriteSchema>;
export function nativeHostIdentity(input:NativeHostWrite){return JSON.stringify({alterId:input.alterId,expectedVersion:input.expectedVersion});}
