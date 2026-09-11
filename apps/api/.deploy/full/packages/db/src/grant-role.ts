import type { PrismaClient, Role } from "@prisma/client";

/**
 * Grant an existing user an additional role. Used by both the standalone CLI
 * (`prisma/grant-role-cli.ts`) and the worker's optional `BOOTSTRAP_ADMIN_EMAIL`
 * startup step (apps/worker/src/main.ts) — one implementation, two callers.
 *
 * Deliberately narrow: finds a user by email and adds one role. Never creates a user,
 * never touches a password, never removes an existing role.
 */
export async function grantRole(
  prisma: PrismaClient,
  email: string,
  role: Role,
): Promise<{ readonly granted: boolean; readonly roles: readonly Role[] }> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { roles: { select: { role: true } } },
  });
  if (!user) {
    throw new Error(`No user with email "${email}" — this only grants a role to an existing account.`);
  }

  const already = user.roles.some((r) => r.role === role);
  if (already) {
    return { granted: false, roles: user.roles.map((r) => r.role) };
  }

  await prisma.userRole.create({ data: { userId: user.id, role } });
  const roles = await prisma.userRole.findMany({ where: { userId: user.id }, select: { role: true } });
  return { granted: true, roles: roles.map((r) => r.role) };
}
