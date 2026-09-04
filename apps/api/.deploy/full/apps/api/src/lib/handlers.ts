import type { EndpointDef } from "@iep/contracts";
import type { Handler } from "../server.js";
import { sendError } from "../server.js";

/**
 * Placeholder for endpoints whose phase has not landed.
 *
 * 501, not 404: the route EXISTS and is declared in the contract, it is simply not built
 * yet. A 404 would read as a broken link and send someone hunting for a typo.
 */
export function notImplementedYet(ep: EndpointDef): Handler {
  return (_request, reply) =>
    sendError(
      reply,
      "NOT_IMPLEMENTED_UNTIL_M2",
      `${ep.operationId} is declared in the contract but not implemented yet`,
    );
}
