import { PrismaClient, Role } from "@prisma/client";

/**
 * Grant an existing user an additional role — a one-off admin utility, not part of
 * `seed.ts`'s config/demo data. Run via `pnpm db:grant-role -- <email> <ROLE>`, or
 * directly in a container's console the same way `seed:config` is run there.
 *
 * Deliberately narrow: it finds a user by email and adds one role. It never creates a
 * user, never touches a password, and never removes an existing role — so this cannot
 * be used to accidentally demote or lock anyone out.
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
    const user = await prisma.user.findUnique({
      where: { email },
      include: { roles: { select: { role: true } } },
    });
    if (!user) {
      console.error(`No user with email "${email}" — this only grants a role to an existing account.`);
      process.exitCode = 1;
      return;
    }

    const already = user.roles.some((r) => r.role === role);
    if (already) {
      console.log(`${email} already has ${role}. Current roles: ${user.roles.map((r) => r.role).join(", ")}`);
      return;
    }

    await prisma.userRole.create({ data: { userId: user.id, role } });
    const roles = await prisma.userRole.findMany({ where: { userId: user.id }, select: { role: true } });
    console.log(`Granted ${role} to ${email}. Roles now: ${roles.map((r) => r.role).join(", ")}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
