import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, ListChecks, Settings, User } from "lucide-react";
import {
  Badge, Button, Card, CardContent, Checkbox, Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, Input, Label, Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue, Switch,
} from "@iep/ui";
import { Role } from "@iep/contracts";
import type { AdminUser, DepartmentListResponse } from "@iep/contracts";
import { ApiError, api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";
import { useSession } from "../../app/use-session";

/**
 * Creating and editing accounts (FR-01, ADR-023).
 *
 * The API for this shipped in P1 with no interface at all, which is why an administrator
 * looking for "add a user" could not find one. This is that interface.
 *
 * Two rules are enforced on the server and mirrored here, in that order — the server is
 * the authority and the UI only explains it early:
 *
 *  - You cannot deactivate yourself, and you cannot remove your own last ADMIN role. Both
 *    are one click from locking the organisation out of its own platform.
 *  - A password is set, never read. There is no field that shows one, and no response
 *    from the API carries one.
 */

const ROLE_HELP: Record<Role, string> = {
  EMPLOYEE: "Submit ideas, see the board, react to other people's ideas.",
  REVIEWER: "Everything an employee can do, plus review decisions and score overrides.",
  MANAGEMENT: "Read-only across the organisation: rankings, dashboard, comparisons.",
  ADMIN: "Everything, including accounts, configuration and the audit log.",
};

const ROLES = Role.options;

/**
 * A role's own colour, borrowed from the ONE place it already has one.
 *
 * AppShell tints each nav destination — Reviews, Dashboard, My ideas — and this page is
 * where the same four words decide who can see them. Reusing those exact pairs means a
 * reviewer's badge here and the "Reviews" icon in the sidebar are the same colour for the
 * same reason, rather than two people having independently picked "orange" and "amber".
 * ADMIN keeps the solid `default` badge rather than Administration's muted nav tone — the
 * sidebar deliberately underplays that link, but a role list is exactly where the highest
 * privilege SHOULD stand out.
 */
const ROLE_ICON: Record<Role, React.ComponentType<{ className?: string }>> = {
  EMPLOYEE: User,
  REVIEWER: ListChecks,
  MANAGEMENT: LayoutDashboard,
  ADMIN: Settings,
};

const ROLE_TONE: Record<Role, string> = {
  EMPLOYEE: "bg-ramp-1 text-accent-700",
  REVIEWER: "bg-state-warn-bg text-state-warn",
  MANAGEMENT: "bg-accent text-accent-foreground",
  ADMIN: "",
};

/** Both forms post to the same two endpoints; both invalidate the same list. */
function useUsersInvalidation() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["admin", "users"] });
}

function useDepartments(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.admin.departments(),
    queryFn: () => api<DepartmentListResponse>("/admin/departments"),
    enabled,
    staleTime: 5 * 60_000,
  });
}

const NO_DEPARTMENT = "__none__";

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message;
  if (error) return "Could not reach the server. Nothing was changed.";
  return null;
}

/* ── roles ── */

function RoleChecklist({
  value,
  onChange,
  disabledRoles = [],
  idPrefix,
}: {
  value: readonly Role[];
  onChange: (next: Role[]) => void;
  /** Roles this actor may not remove from this account — with a reason shown beside it. */
  disabledRoles?: readonly { role: Role; reason: string }[];
  idPrefix: string;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-200 font-medium">Roles</legend>
      {ROLES.map((role) => {
        const locked = disabledRoles.find((d) => d.role === role);
        const id = `${idPrefix}-role-${role.toLowerCase()}`;
        return (
          <div key={role} className="flex items-start gap-3">
            <Checkbox
              id={id}
              checked={value.includes(role)}
              disabled={Boolean(locked)}
              onCheckedChange={(checked) =>
                onChange(
                  checked === true
                    ? [...value.filter((r) => r !== role), role]
                    : value.filter((r) => r !== role),
                )
              }
            />
            <div className="min-w-0">
              <Label htmlFor={id} className="font-medium">
                {role.charAt(0) + role.slice(1).toLowerCase()}
              </Label>
              <p className="text-100 text-muted-foreground">{ROLE_HELP[role]}</p>
              {locked ? (
                <p className="mt-0.5 text-100 text-muted-foreground">{locked.reason}</p>
              ) : null}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}

function DepartmentSelect({
  value,
  onChange,
  enabled,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  enabled: boolean;
}) {
  const departments = useDepartments(enabled);

  return (
    <div>
      <Label htmlFor="field-department">Department</Label>
      <Select
        value={value ?? NO_DEPARTMENT}
        onValueChange={(next) => onChange(next === NO_DEPARTMENT ? null : next)}
      >
        <SelectTrigger id="field-department" className="mt-1.5 w-full">
          <SelectValue placeholder="Not set" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_DEPARTMENT}>Not set</SelectItem>
          {(departments.data?.items ?? []).map((department) => (
            <SelectItem key={department.id} value={department.id}>
              {department.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-1.5 text-100 text-muted-foreground">
        Drives the department filters and the management dashboard. People who signed
        themselves up arrive without one.
      </p>
    </div>
  );
}

/* ── create ── */

export function AddUserDialog() {
  const [open, setOpen] = React.useState(false);
  const [displayName, setDisplayName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [initialPassword, setInitialPassword] = React.useState("");
  const [roles, setRoles] = React.useState<Role[]>(["EMPLOYEE"]);
  const [departmentId, setDepartmentId] = React.useState<string | null>(null);
  const invalidate = useUsersInvalidation();

  const create = useMutation({
    mutationFn: () =>
      api<AdminUser>("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          displayName: displayName.trim(),
          email: email.trim(),
          initialPassword,
          roles,
          departmentId,
        }),
      }),
    onSuccess: () => {
      invalidate();
      setOpen(false);
      setDisplayName("");
      setEmail("");
      setInitialPassword("");
      setRoles(["EMPLOYEE"]);
      setDepartmentId(null);
    },
  });

  const message = errorMessage(create.error);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) create.reset();
      }}
    >
      <Button onClick={() => setOpen(true)}>Add someone</Button>

      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add someone</DialogTitle>
          <DialogDescription>
            They can sign in straight away with the password you set here. Tell it to them
            over a channel you trust — you will not be able to read it back.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <div>
            <Label htmlFor="field-new-name">Name</Label>
            <Input
              id="field-new-name"
              required
              autoComplete="off"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="field-new-email">Email address</Label>
            <Input
              id="field-new-email"
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="field-new-password">Initial password</Label>
            <Input
              id="field-new-password"
              type="text"
              required
              autoComplete="off"
              value={initialPassword}
              onChange={(e) => setInitialPassword(e.target.value)}
              aria-describedby="field-new-password-hint"
              className="mt-1.5"
            />
            {/*
              Shown as plain text on purpose. This is a value the administrator has to read
              off the screen and pass on; masking it would only mean typing it twice into a
              box and trusting the match.
            */}
            <p id="field-new-password-hint" className="mt-1.5 text-100 text-muted-foreground">
              At least 12 characters. Visible so you can copy it — it is not stored in a
              form you or anyone else can read again.
            </p>
          </div>

          <DepartmentSelect value={departmentId} onChange={setDepartmentId} enabled={open} />

          <RoleChecklist value={roles} onChange={setRoles} idPrefix="new" />

          {message ? (
            <p role="alert" className="text-200 text-destructive">
              {message}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || roles.length === 0}>
              {create.isPending ? "Creating…" : "Create account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── edit ── */

export function EditUserDialog({
  user,
  onClose,
}: {
  user: AdminUser | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(user)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {/*
          Keyed on the account id, so opening a different person REMOUNTS the form.
          The alternative — one long-lived form resetting itself in an effect when the
          prop changes — is a cascading render and, worse, one frame in which somebody
          else's roles are on screen under this person's name.
        */}
        {user ? <EditUserForm key={user.id} user={user} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EditUserForm({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const session = useSession();
  const invalidate = useUsersInvalidation();
  const isSelf = session.data?.user.id === user.id;

  // Initialised from props once, because the component is remounted per account.
  const [roles, setRoles] = React.useState<Role[]>([...user.roles]);
  const [departmentId, setDepartmentId] = React.useState<string | null>(
    user.department?.id ?? null,
  );
  const [isActive, setIsActive] = React.useState(user.isActive);
  const [newPassword, setNewPassword] = React.useState("");

  const save = useMutation({
    mutationFn: () =>
      api<AdminUser>(`/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          roles,
          departmentId,
          isActive,
          ...(newPassword ? { newPassword } : {}),
        }),
      }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const message = errorMessage(save.error);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{user.displayName}</DialogTitle>
        <DialogDescription>{user.email}</DialogDescription>
      </DialogHeader>

      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <DepartmentSelect value={departmentId} onChange={setDepartmentId} enabled />

        <RoleChecklist
          value={roles}
          onChange={setRoles}
          idPrefix="edit"
          disabledRoles={
            isSelf
              ? [
                  {
                    role: "ADMIN",
                    reason:
                      "You cannot remove your own administrator role. Ask another administrator.",
                  },
                ]
              : []
          }
        />

        <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
          <div className="min-w-0">
            <Label htmlFor="field-active" className="font-medium">
              Active
            </Label>
            <p className="text-100 text-muted-foreground">
              {/*
                Deactivation, never deletion: the audit log references users and is
                append-only, so removing the row would break the trail it exists for.
              */}
              Turning this off blocks sign-in and keeps everything they have submitted.
              Accounts are never deleted — the audit trail refers to them.
            </p>
            {isSelf ? (
              <p className="mt-1 text-100 text-muted-foreground">
                You cannot deactivate your own account.
              </p>
            ) : null}
          </div>
          <Switch
            id="field-active"
            checked={isActive}
            disabled={isSelf}
            onCheckedChange={setIsActive}
          />
        </div>

        <div>
          <Label htmlFor="field-reset-password">Set a new password</Label>
          <Input
            id="field-reset-password"
            type="text"
            autoComplete="off"
            placeholder="Leave blank to keep the current one"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            aria-describedby="field-reset-hint"
            className="mt-1.5"
          />
          <p id="field-reset-hint" className="mt-1.5 text-100 text-muted-foreground">
            At least 12 characters. This is how a locked-out account is recovered — setting
            a password clears the lockout as well.
          </p>
        </div>

        {message ? (
          <p role="alert" className="text-200 text-destructive">
            {message}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending || roles.length === 0}>
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

/** The roles column, as chips rather than a joined string. */
export function RoleBadges({ roles }: { roles: readonly Role[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((role) => {
        const Icon = ROLE_ICON[role];
        return (
          <Badge
            key={role}
            variant={role === "ADMIN" ? "default" : "secondary"}
            className={ROLE_TONE[role]}
          >
            <Icon aria-hidden className="size-3" />
            {role.charAt(0) + role.slice(1).toLowerCase()}
          </Badge>
        );
      })}
    </span>
  );
}

/** A short, honest explanation of what the roles mean, for the page itself. */
export function RoleLegend() {
  return (
    // A softer, sunken panel rather than another white card — this is reference
    // material sitting below the table, not another row of data to scan.
    <Card className="mt-6 border-border/80 bg-muted py-0 shadow-none">
      <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
        {ROLES.map((role) => {
          const Icon = ROLE_ICON[role];
          return (
            <div key={role} className="flex items-start gap-3">
              <span
                aria-hidden
                className={`grid size-8 shrink-0 place-items-center rounded-lg ${
                  role === "ADMIN" ? "bg-accent text-accent-foreground" : ROLE_TONE[role]
                }`}
              >
                <Icon className="size-4" />
              </span>
              <p className="text-200">
                <span className="font-medium">
                  {role.charAt(0) + role.slice(1).toLowerCase()}
                </span>{" "}
                <span className="text-muted-foreground">{ROLE_HELP[role]}</span>
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
