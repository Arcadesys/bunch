import { z } from "zod";
import { uuidSchema } from "./contracts";

const episode = z.object({ id: uuidSchema, version: z.number().int().positive() }).strict();
export const nativeSwitchSchema = z.object({
  requestId: uuidSchema,
  reviewed: z.array(episode).max(100),
  end: z.array(episode).max(100),
  start: z.array(uuidSchema).max(100),
}).strict().superRefine((v, ctx) => {
  for (const list of [v.reviewed.map(x => x.id), v.end.map(x => x.id), v.start]) {
    if (new Set(list).size !== list.length) ctx.addIssue({code:"custom",message:"Duplicate selection"});
  }
  if (!v.end.length && !v.start.length) ctx.addIssue({code:"custom",message:"No change selected"});
  const reviewed = new Map(v.reviewed.map(x => [x.id,x.version]));
  if (v.end.some(x => reviewed.get(x.id) !== x.version)) ctx.addIssue({code:"custom",message:"End selection was not reviewed"});
});
export type NativeSwitch = z.infer<typeof nativeSwitchSchema>;
export function nativeSwitchIdentity(input: NativeSwitch) {
  return JSON.stringify({reviewed:[...input.reviewed].sort((a,b)=>a.id.localeCompare(b.id)),end:[...input.end].sort((a,b)=>a.id.localeCompare(b.id)),start:[...input.start].sort()});
}
