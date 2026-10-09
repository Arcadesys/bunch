import { getPilotService } from "./pilot-service";
import { requireOwnerId } from "./auth";
import { normalizeSystemError } from "./system-error";

type AdminAccessDependencies = {
  requireOwnerId(request?: Request): Promise<string>;
  assertOperator(ownerId: string): Promise<void>;
};

export async function requireAdminId(
  request?: Request,
  dependencies: AdminAccessDependencies = {
    requireOwnerId,
    assertOperator: (ownerId) => getPilotService().assertOperator(ownerId),
  },
) {
  let ownerId: string;
  try {
    ownerId = await dependencies.requireOwnerId(request);
  } catch (error) {
    throw normalizeSystemError(error);
  }
  await dependencies.assertOperator(ownerId);
  return ownerId;
}
