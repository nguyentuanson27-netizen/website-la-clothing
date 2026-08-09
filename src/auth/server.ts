import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

import { readAuthServerConfig } from "@/auth/config";
import { prisma } from "@/db/prisma";

const config = readAuthServerConfig();

export const auth = betterAuth({
  appName: "LA Clothing",
  baseURL: config.baseURL,
  secret: config.secret,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  user: {
    additionalFields: {
      role: {
        type: ["CUSTOMER", "ADMIN"],
        required: false,
        defaultValue: "CUSTOMER",
        input: false,
      },
    },
  },
});
