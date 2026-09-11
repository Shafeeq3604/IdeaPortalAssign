import { PrismaClient, Role } from "@prisma/client";
import { grantRole } from "../src/grant-role.js";

/**
 * Grant an existing user an additional role — a one-off admin utility, not part of
 * `seed.ts`'s config/demo data. Run via `pnpm db:grant-role -- <email> <ROLE>`, or
 * directly in a container's console the same way `seed:config` is run there.
 *
 * See `src/grant-role.ts` for the actual logic — also used by the worker's optional
 * `BOOTSTRAP_ADMIN_EMAIL` startup step for environments with no console access at all.
 */
async function main(): Promise<void> {
  const [, , email, roleArg] = process.argv;
  if (!email || !roleArg) {
    console.error("Usage: tsx prisma/grant-role-cli.ts <email> <ROLE>");
    console.error(`ROLE must be one of: ${Object.values(Role).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const role = roleArg.toUpperCase() as Role;
  if (!Object.values(Role).includes(role)) {
    console.error(`Unknown role "${roleArg}". Must be one of: ${Object.values(Role).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const outcome = await grantRole(prisma, email, role);
    console.log(
      outcome.granted
        ? `Granted ${role} to ${email}. Roles now: ${outcome.roles.join(", ")}`
        : `${email} already has ${role}. Current roles: ${outcome.roles.join(", ")}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
