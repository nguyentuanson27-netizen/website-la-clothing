import { prisma } from "../db/prisma.ts";
import { PancakeClient } from "../integrations/pancake/client.ts";
import { readPancakeConfig } from "../integrations/pancake/config.ts";
import { createPancakeOrderGateway } from "../integrations/pancake/order-gateway.ts";
import {
  createPancakeOrderSubmissionService,
  type PancakeOrderSubmissionEvent,
} from "./pancake-order-submit.ts";

function writePancakeOrderSubmissionEvent(event: PancakeOrderSubmissionEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

export async function submitPancakeOrderByPublicCode(publicCode: string) {
  const config = readPancakeConfig();
  const client = new PancakeClient({ apiKey: config.apiKey });
  const gateway = createPancakeOrderGateway(client);
  const service = createPancakeOrderSubmissionService(prisma, gateway, {
    onEvent: writePancakeOrderSubmissionEvent,
  });

  return service.submit({ publicCode, shopId: config.shopId });
}
