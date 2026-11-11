import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { toast } from "sonner";
import type { Route } from "./+types/team";
import { getCurrentUserId } from "~/lib/session";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Users, BookOpen, Copy, Check, AlertTriangle } from "lucide-react";
import { data, isRouteErrorResponse } from "react-router";
import { db } from "~/db";
import {
  teams,
  teamMembers,
  coupons,
  courses,
  purchases,
  users,
  TeamMemberRole,
} from "~/db/schema";
import { eq, and } from "drizzle-orm";
import {
  checkRefundRequestEligibility,
  checkSeatCodeRedeemable,
  getLatestRefundRequest,
} from "~/lib/refund-requests.server";
import { getRefundState } from "~/lib/refund-status";
import { RefundRequestBanner } from "~/components/refund-request-banner";
import { formatPrice } from "~/lib/utils";

function getTeamForAdmin(userId: number) {
  const membership = db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.role, TeamMemberRole.Admin)
      )
    )
    .get();

  if (!membership) return undefined;

  return db.select().from(teams).where(eq(teams.id, membership.teamId)).get();
}

function getCouponsForTeam(teamId: number) {
  return db
    .select()
    .from(coupons)
    .where(eq(coupons.teamId, teamId))
    .orderBy(coupons.id)
    .all();
}

function getCourseById(id: number) {
  return db.select().from(courses).where(eq(courses.id, id)).get();
}

function getPurchaseById(id: number) {
  return db.select().from(purchases).where(eq(purchases.id, id)).get();
}

function getUserById(id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

interface CourseStats {
  courseId: number;
  courseTitle: string;
  courseSlug: string;
  totalSeats: number;
  redeemedSeats: number;
}

type SeatCodeStatus =
  | { kind: "redeemed"; email: string | null }
  | { kind: "invalidated" }
  | { kind: "refund_in_progress" }
  | { kind: "available" };

interface SeatCodeRow {
  id: number;
  code: string;
  status: SeatCodeStatus;
}

type PurchaseRefund =
  | {
      kind: "request";
      state: ReturnType<typeof getRefundState>;
      amount: number;
      requestedAt: string;
      declineReason: string | null;
      seatBreakdown: NonNullable<
        ReturnType<typeof getLatestRefundRequest>
      >["seatBreakdown"];
    }
  | { kind: "eligible"; amount: number; lastDayInWindow: string }
  | { kind: "none" };

interface PurchaseGroup {
  purchaseId: number;
  courseId: number;
  courseTitle: string;
  courseSlug: string;
  purchasedAt: string;
  amountPaid: number;
  seatCodes: SeatCodeRow[];
  refund: PurchaseRefund;
}

const NO_TEAM_MESSAGE =
  "You don't have a team. Purchase team seats to create one.";

export function meta() {
  return [
    { title: "Team — Cadence" },
    { name: "description", content: "Manage your team's course seats" },
  ];
}

function describeSeatCodeStatus(
  coupon: typeof coupons.$inferSelect
): SeatCodeStatus {
  const redeemability = checkSeatCodeRedeemable(coupon.id);
  if (!redeemability.redeemable && redeemability.reason === "invalidated") {
    return { kind: "invalidated" };
  }
  if (coupon.redeemedByUserId !== null) {
    const user = getUserById(coupon.redeemedByUserId);
    return { kind: "redeemed", email: user?.email ?? null };
  }
  if (!redeemability.redeemable) return { kind: "refund_in_progress" };
  return { kind: "available" };
}

function describePurchaseRefund(
  userId: number,
  purchaseId: number
): PurchaseRefund {
  const refundRequest = getLatestRefundRequest(purchaseId);
  if (refundRequest) {
    return {
      kind: "request",
      state: getRefundState(refundRequest.status, refundRequest.refundStatus),
      amount: refundRequest.amount,
      requestedAt: refundRequest.requestedAt,
      declineReason: refundRequest.declineReason,
      seatBreakdown: refundRequest.seatBreakdown,
    };
  }

  const eligibility = checkRefundRequestEligibility(userId, purchaseId);
  if (eligibility.eligible) {
    return {
      kind: "eligible",
      amount: eligibility.amount,
      lastDayInWindow: eligibility.lastDayInWindow,
    };
  }

  return { kind: "none" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  const team = getTeamForAdmin(currentUserId);

  if (!team) {
    throw data(NO_TEAM_MESSAGE, {
      status: 403,
    });
  }

  const allCoupons = getCouponsForTeam(team.id);

  const courseMap = new Map<number, CourseStats>();
  const purchaseMap = new Map<number, PurchaseGroup>();

  for (const coupon of allCoupons) {
    let stats = courseMap.get(coupon.courseId);
    let group = purchaseMap.get(coupon.purchaseId);

    if (!stats || !group) {
      const course = getCourseById(coupon.courseId);
      const courseTitle = course?.title ?? "Unknown Course";
      const courseSlug = course?.slug ?? "";

      if (!stats) {
        stats = {
          courseId: coupon.courseId,
          courseTitle,
          courseSlug,
          totalSeats: 0,
          redeemedSeats: 0,
        };
        courseMap.set(coupon.courseId, stats);
      }

      if (!group) {
        const purchase = getPurchaseById(coupon.purchaseId);
        group = {
          purchaseId: coupon.purchaseId,
          courseId: coupon.courseId,
          courseTitle,
          courseSlug,
          purchasedAt: purchase?.createdAt ?? coupon.createdAt,
          amountPaid: purchase?.amountPaid ?? 0,
          seatCodes: [],
          refund: describePurchaseRefund(currentUserId, coupon.purchaseId),
        };
        purchaseMap.set(coupon.purchaseId, group);
      }
    }

    stats.totalSeats++;
    if (coupon.redeemedByUserId !== null) {
      stats.redeemedSeats++;
    }

    group.seatCodes.push({
      id: coupon.id,
      code: coupon.code,
      status: describeSeatCodeStatus(coupon),
    });
  }

  const courseStats = Array.from(courseMap.values());
  const purchaseGroups = Array.from(purchaseMap.values()).sort((a, b) =>
    b.purchasedAt.localeCompare(a.purchasedAt)
  );

  return { courseStats, purchaseGroups };
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const url = `${window.location.origin}/redeem/${code}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
      title="Copy redemption link"
    >
      {copied ? (
        <>
          <Check className="size-3" />
          Copied
        </>
      ) : (
        <>
          <Copy className="size-3" />
          Copy link
        </>
      )}
    </button>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function TeamRefundRequestForm({
  slug,
  purchaseId,
  amount,
  lastDayInWindow,
}: {
  slug: string;
  purchaseId: number;
  amount: number;
  lastDayInWindow: string;
}) {
  const fetcher = useFetcher<{ errors?: Record<string, string> }>();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    const firstError = Object.values(fetcher.data?.errors ?? {})[0];
    if (fetcher.state === "idle" && firstError) {
      toast.error(firstError);
    }
  }, [fetcher.state, fetcher.data]);

  if (!isFormOpen) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => setIsFormOpen(true)}
      >
        Request a refund
      </Button>
    );
  }

  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-medium">Request a refund</p>
      <p className="mb-3 text-xs text-muted-foreground">
        None of these seat codes has been redeemed yet, so you can ask for the
        full {formatPrice(amount)} back until{" "}
        {formatDate(lastDayInWindow)}. Once we have reviewed your refund
        request, we will send the money back to the card you paid with if it is
        approved. While we review it, these seat codes cannot be redeemed.
      </p>
      <fetcher.Form
        method="post"
        action={`/courses/${slug}/refund-request`}
        className="space-y-2"
      >
        <input type="hidden" name="purchaseId" value={purchaseId} />
        <Textarea
          name="reason"
          rows={3}
          required
          placeholder="What went wrong?"
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={isSubmitting}>
            {isSubmitting ? "Sending..." : "Request a refund"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsFormOpen(false)}
          >
            Keep it
          </Button>
        </div>
      </fetcher.Form>
    </div>
  );
}

function SeatCodeStatusLabel({ status }: { status: SeatCodeStatus }) {
  switch (status.kind) {
    case "redeemed":
      return (
        <span className="text-muted-foreground">
          Redeemed{status.email ? ` by ${status.email}` : ""}
        </span>
      );
    case "invalidated":
      return (
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          No longer valid
        </span>
      );
    case "refund_in_progress":
      return (
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          On hold during refund
        </span>
      );
    case "available":
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
          Not redeemed
        </span>
      );
  }
}

function PurchaseCard({ group }: { group: PurchaseGroup }) {
  const { refund } = group;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold">{group.courseTitle}</h3>
          <p className="text-sm text-muted-foreground">
            Purchased {formatDate(group.purchasedAt)} ·{" "}
            {group.seatCodes.length}{" "}
            {group.seatCodes.length === 1 ? "seat" : "seats"} ·{" "}
            {formatPrice(group.amountPaid)} paid
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Seat Code</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {group.seatCodes.map((seatCode) => (
                <tr key={seatCode.id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <code
                      className={`rounded bg-muted px-2 py-0.5 text-xs ${
                        seatCode.status.kind === "invalidated"
                          ? "line-through text-muted-foreground"
                          : ""
                      }`}
                    >
                      {seatCode.code}
                    </code>
                  </td>
                  <td className="px-4 py-3">
                    <SeatCodeStatusLabel status={seatCode.status} />
                  </td>
                  <td className="px-4 py-3">
                    {seatCode.status.kind === "available" && (
                      <CopyButton code={seatCode.code} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {refund.kind === "request" && (
          <RefundRequestBanner
            state={refund.state}
            amount={refund.amount}
            requestedAt={refund.requestedAt}
            declineReason={refund.declineReason}
            seatBreakdown={refund.seatBreakdown}
            audience="team"
          />
        )}
        {refund.kind === "eligible" && (
          <TeamRefundRequestForm
            slug={group.courseSlug}
            purchaseId={group.purchaseId}
            amount={refund.amount}
            lastDayInWindow={refund.lastDayInWindow}
          />
        )}
      </CardContent>
    </Card>
  );
}

export default function Team({ loaderData }: Route.ComponentProps) {
  const { courseStats, purchaseGroups } = loaderData;
  const [courseFilter, setCourseFilter] = useState<number | "all">("all");

  const filteredGroups =
    courseFilter === "all"
      ? purchaseGroups
      : purchaseGroups.filter((group) => group.courseId === courseFilter);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Team</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Team Management</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your team&apos;s course seats and seat codes
        </p>
      </div>

      {/* Per-course stats */}
      {courseStats.length > 0 && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courseStats.map((stat) => (
            <Card key={stat.courseId}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <BookOpen className="size-4 text-muted-foreground" />
                  <h3 className="font-semibold truncate">{stat.courseTitle}</h3>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-bold">
                      {stat.redeemedSeats}
                      <span className="text-base font-normal text-muted-foreground">
                        {" "}
                        / {stat.totalSeats}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      seats redeemed
                    </p>
                  </div>
                  <Link to={`/courses/${stat.courseSlug}/purchase?mode=team`}>
                    <Button variant="outline" size="sm">
                      Buy more seats
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Seat Codes, grouped by Team Purchase */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Users className="size-5 text-muted-foreground" />
            Seat Codes
          </h2>
          {courseStats.length > 1 && (
            <select
              value={courseFilter}
              onChange={(e) =>
                setCourseFilter(
                  e.target.value === "all" ? "all" : Number(e.target.value)
                )
              }
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              <option value="all">All courses</option>
              {courseStats.map((stat) => (
                <option key={stat.courseId} value={stat.courseId}>
                  {stat.courseTitle}
                </option>
              ))}
            </select>
          )}
        </div>

        {filteredGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No seat codes yet.</p>
        ) : (
          <div className="space-y-6">
            {filteredGroups.map((group) => (
              <PurchaseCard key={group.purchaseId} group={group} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403 && error.data === NO_TEAM_MESSAGE) {
      title = "No team found";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have a team yet.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
          <Link to="/courses">
            <Button variant="outline">Browse Courses</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
