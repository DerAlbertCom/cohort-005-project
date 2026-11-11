import { useEffect, useState } from "react";
import { data, isRouteErrorResponse, Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { AlertTriangle, ReceiptText } from "lucide-react";
import type { Route } from "./+types/admin.refund-requests";
import { requireAdmin } from "~/lib/access.server";
import {
  approveRefundRequest,
  createRefundOverride,
  declineRefundRequest,
  listPurchasesWithoutRefundRequest,
  listRefundRequestsForAdmin,
  markRefundFailed,
  markRefundIssued,
  REFUND_REQUEST_FILTERS,
  restoreRefundedAccess,
  type AdminRefundRequestRow,
  type PurchaseWithoutRefundRequest,
  type RefundActionResult,
  type RefundRequestFilter,
} from "~/lib/refund-requests.server";
import { getRefundState, REFUND_STATE_LABELS } from "~/lib/refund-status";
import { describeSeat } from "~/lib/team-refund";
import { cn, formatPrice } from "~/lib/utils";
import { parseFormData } from "~/lib/validation";
import { RefundRequestStatus, RefundStatus } from "~/db/schema";
import type { SeatBreakdownEntry } from "~/db/schema";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";

const ACTION_FETCHER_KEY = "refund-request-action";

const reasonSchema = z
  .string()
  .trim()
  .min(10, "The reason must be at least 10 characters.")
  .max(1000, "The reason must be at most 1000 characters.");

const refundActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("approve"),
    refundRequestId: z.coerce.number().int(),
  }),
  z.object({
    intent: z.literal("decline"),
    refundRequestId: z.coerce.number().int(),
    reason: reasonSchema,
  }),
  z.object({
    intent: z.literal("mark-issued"),
    refundRequestId: z.coerce.number().int(),
  }),
  z.object({
    intent: z.literal("mark-failed"),
    refundRequestId: z.coerce.number().int(),
  }),
  z.object({
    intent: z.literal("restore-access"),
    refundRequestId: z.coerce.number().int(),
  }),
  z.object({
    intent: z.literal("new-refund"),
    purchaseId: z.coerce.number().int(),
    reason: reasonSchema,
  }),
]);

const searchSchema = z.object({
  status: z.enum(REFUND_REQUEST_FILTERS).catch("open"),
});

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    { name: "description", content: "Review refund requests and refunds" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);

  const url = new URL(request.url);
  const { status } = searchSchema.parse({
    status: url.searchParams.get("status") ?? undefined,
  });

  return {
    filter: status,
    refundRequests: listRefundRequestsForAdmin(status),
    purchases: listPurchasesWithoutRefundRequest(),
  };
}

function orThrow(result: RefundActionResult) {
  if (!result.ok) throw data(result.error, { status: 409 });
}

export async function action({ request }: Route.ActionArgs) {
  const { userId } = await requireAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundActionSchema);

  if (!parsed.success) {
    if (parsed.errors.reason) {
      return data(
        { fieldErrors: { reason: parsed.errors.reason } },
        { status: 400 }
      );
    }
    throw data("Invalid input.", { status: 400 });
  }

  const input = parsed.data;
  switch (input.intent) {
    case "approve":
      orThrow(approveRefundRequest(input.refundRequestId, userId));
      return { ok: true, message: "Refund request approved." };
    case "decline":
      orThrow(declineRefundRequest(input.refundRequestId, userId, input.reason));
      return { ok: true, message: "Refund request declined." };
    case "mark-issued":
      orThrow(markRefundIssued(input.refundRequestId));
      return { ok: true, message: "Refund marked as issued." };
    case "mark-failed":
      orThrow(markRefundFailed(input.refundRequestId));
      return { ok: true, message: "Refund marked as failed." };
    case "restore-access":
      orThrow(restoreRefundedAccess(input.refundRequestId));
      return { ok: true, message: "Access restored." };
    case "new-refund":
      orThrow(createRefundOverride(input.purchaseId, userId, input.reason));
      return { ok: true, message: "Refund created and approved." };
  }
}

// ─── Wording ───

const FILTER_TABS: { value: RefundRequestFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
  { value: "pending", label: "Refund pending" },
  { value: "failed", label: "Refund failed" },
  { value: "issued", label: "Refunded" },
  { value: "all", label: "All" },
];

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function possessive(name: string) {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function describeSeats(seats: { total: number; redeemed: number } | null) {
  if (!seats) return "Individual";
  return `Team · ${seats.redeemed} of ${seats.total} seats redeemed`;
}

function SeatBreakdown({ seats }: { seats: SeatBreakdownEntry[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-sm">
      {seats.map((seat) => (
        <li
          key={seat.couponId}
          className={seat.refunded ? undefined : "text-muted-foreground"}
        >
          {describeSeat(seat)}
        </li>
      ))}
    </ul>
  );
}

// ─── Confirmation dialog ───

type ConfirmActionProps = {
  trigger: string;
  triggerVariant?: "default" | "outline" | "destructive" | "secondary";
  title: string;
  confirmLabel: string;
  confirmVariant?: "default" | "destructive";
  fields: Record<string, string>;
  /** Ask for a reason (10–1000 characters) inside the dialog. */
  reason?: { label: string; placeholder: string };
  disabled?: boolean;
  children: React.ReactNode;
};

function ConfirmAction({
  trigger,
  triggerVariant = "outline",
  title,
  confirmLabel,
  confirmVariant = "default",
  fields,
  reason,
  disabled,
  children,
}: ConfirmActionProps) {
  const fetcher = useFetcher<typeof action>({ key: ACTION_FETCHER_KEY });
  const [open, setOpen] = useState(false);
  const [submittedHere, setSubmittedHere] = useState(false);
  const [reasonText, setReasonText] = useState("");

  const isSubmitting = submittedHere && fetcher.state !== "idle";
  const fieldError =
    submittedHere &&
    fetcher.state === "idle" &&
    fetcher.data &&
    "fieldErrors" in fetcher.data
      ? fetcher.data.fieldErrors.reason
      : undefined;

  useEffect(() => {
    if (
      submittedHere &&
      fetcher.state === "idle" &&
      fetcher.data &&
      "ok" in fetcher.data
    ) {
      setOpen(false);
      setSubmittedHere(false);
      setReasonText("");
    }
  }, [submittedHere, fetcher.state, fetcher.data]);

  const trimmedLength = reasonText.trim().length;
  const reasonValid = !reason || (trimmedLength >= 10 && trimmedLength <= 1000);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (isSubmitting) return;
        setOpen(next);
        if (!next) setSubmittedHere(false);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button size="sm" variant={triggerVariant} disabled={disabled}>
          {trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <fetcher.Form
          method="post"
          className="grid gap-4"
          onSubmit={() => setSubmittedHere(true)}
        >
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure? {title}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">{children}</div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {reason && (
            <div className="grid gap-2">
              <Label htmlFor={`reason-${Object.values(fields).join("-")}`}>
                {reason.label}
              </Label>
              <Textarea
                id={`reason-${Object.values(fields).join("-")}`}
                name="reason"
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder={reason.placeholder}
                minLength={10}
                maxLength={1000}
                required
                aria-invalid={fieldError ? true : undefined}
              />
              <p
                className={cn(
                  "text-xs",
                  fieldError ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {fieldError ?? `${trimmedLength}/1000 characters (at least 10)`}
              </p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={isSubmitting}>
              Cancel
            </AlertDialogCancel>
            <Button
              type="submit"
              variant={confirmVariant}
              disabled={isSubmitting || !reasonValid}
            >
              {isSubmitting ? "Working…" : confirmLabel}
            </Button>
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Row actions ───

function RowActions({ row }: { row: AdminRefundRequestRow }) {
  const purchaser = row.purchaserName;
  const studentNames = row.affectedStudents.map((student) => student.name);
  const students = joinNames(studentNames);
  const isTeam = row.seats !== null;
  const fields = { refundRequestId: String(row.id) };

  const isOpen = row.status === RefundRequestStatus.Open;
  const isDeclined = row.status === RefundRequestStatus.Declined;
  const isApproved = row.status === RefundRequestStatus.Approved;
  const canMarkIssued =
    isApproved &&
    (row.refundStatus === RefundStatus.Pending ||
      row.refundStatus === RefundStatus.Failed);
  const canMarkFailed = isApproved && row.refundStatus === RefundStatus.Pending;
  const canRestore = row.refundStatus === RefundStatus.Issued && row.accessRevoked;

  const approval = row.approval;
  const showApprove = (isOpen || isDeclined) && approval !== null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showApprove && !approval.refundable && (
        <p className="text-sm text-muted-foreground">
          Cannot be approved: {approval.reason}
        </p>
      )}
      {showApprove && approval.refundable && (
        <ConfirmAction
          trigger={isDeclined ? "Approve (override)" : "Approve"}
          triggerVariant="default"
          title={isDeclined ? "Approve this declined request" : "Approve this refund"}
          confirmLabel={`Approve ${formatPrice(approval.amount)} refund`}
          fields={{ ...fields, intent: "approve" }}
        >
          {isDeclined && (
            <p>
              This is a Refund Override: it waives the refund window. The
              progress limits still apply.
            </p>
          )}
          {!isTeam ? (
            <p>
              {purchaser} will be read-only and will get{" "}
              {formatPrice(approval.amount)} back.
            </p>
          ) : (
            <p>
              {purchaser} will get {formatPrice(approval.amount)} back
              {approval.amount < row.amountPaid
                ? ` of the ${formatPrice(row.amountPaid)} paid`
                : ""}
              .
            </p>
          )}
          {isTeam && approval.affectedStudents.length > 0 && (
            <p>
              {joinNames(approval.affectedStudents.map((s) => s.name))} will be
              read-only until the refund is issued, and will be emailed.
            </p>
          )}
          {isTeam && (
            <p>The refunded seat codes can no longer be redeemed.</p>
          )}
          {approval.seatBreakdown && (
            <SeatBreakdown seats={approval.seatBreakdown} />
          )}
          <p>
            {purchaser} will be emailed that the request was approved. Approval
            is final: afterwards the refund can only be marked issued or failed.
          </p>
        </ConfirmAction>
      )}
      {isOpen && (
        <ConfirmAction
          trigger="Decline"
          triggerVariant="outline"
          title="Decline this request"
          confirmLabel="Decline request"
          confirmVariant="destructive"
          fields={{ ...fields, intent: "decline" }}
          reason={{
            label: `Reason (shown to ${purchaser})`,
            placeholder: "Explain why the refund request is declined…",
          }}
        >
          {isTeam ? (
            <p>
              Declining restores full access
              {studentNames.length > 0 ? ` for ${students}` : ""} and makes the
              seat codes redeemable again. {purchaser} will see your reason.
            </p>
          ) : (
            <p>
              Declining restores {possessive(purchaser)} full access.{" "}
              {purchaser} will see your reason.
            </p>
          )}
          <p>No money will be returned.</p>
        </ConfirmAction>
      )}
      {canMarkIssued && (
        <ConfirmAction
          trigger="Mark Issued"
          triggerVariant="default"
          title="Mark this refund as issued"
          confirmLabel="Mark issued"
          fields={{ ...fields, intent: "mark-issued" }}
        >
          <p>
            Confirm that {formatPrice(row.amount)} has been sent to {purchaser}.
            {" "}
            {purchaser} will be emailed.
          </p>
          {studentNames.length > 0 && (
            <p>
              {students} {studentNames.length === 1 ? "loses" : "lose"} access
              to {row.courseTitle} now and will be emailed.
            </p>
          )}
          {isTeam && (
            <p>The refunded seat codes become permanently invalid.</p>
          )}
          {row.seatBreakdown && <SeatBreakdown seats={row.seatBreakdown} />}
        </ConfirmAction>
      )}
      {canMarkFailed && (
        <ConfirmAction
          trigger="Mark Failed"
          triggerVariant="outline"
          title="Mark this refund as failed"
          confirmLabel="Mark failed"
          confirmVariant="destructive"
          fields={{ ...fields, intent: "mark-failed" }}
        >
          <p>
            Sending {formatPrice(row.amount)} to {purchaser} did not work.{" "}
            {purchaser} will be emailed that we are working on it.
          </p>
          <p>
            The request stays approved
            {studentNames.length > 0
              ? ` and ${students} ${studentNames.length === 1 ? "stays" : "stay"} read-only`
              : ""}
            . You can mark it issued later.
          </p>
        </ConfirmAction>
      )}
      {canRestore && (
        <ConfirmAction
          trigger="Restore access"
          triggerVariant="secondary"
          title="Restore access"
          confirmLabel="Restore access"
          fields={{ ...fields, intent: "restore-access" }}
        >
          <p>
            {students || purchaser} will get access to {row.courseTitle} back,
            with their earlier progress.
          </p>
          <p>This only gives access back; it does not affect any money.</p>
        </ConfirmAction>
      )}
    </div>
  );
}

function RefundRequestCard({ row }: { row: AdminRefundRequestRow }) {
  const state = getRefundState(row.status, row.refundStatus);

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-medium">
              {row.purchaserName}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                {row.purchaserEmail}
              </span>
            </p>
            <p className="text-sm">
              <Link
                to={`/courses/${row.courseSlug}`}
                className="hover:underline"
              >
                {row.courseTitle}
              </Link>
              <span className="text-muted-foreground">
                {" "}
                · {describeSeats(row.seats)}
              </span>
            </p>
          </div>
          <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
            {REFUND_STATE_LABELS[state]}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Amount Paid</dt>
            <dd>{formatPrice(row.amountPaid)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Refund amount</dt>
            <dd>{formatPrice(row.amount)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Requested</dt>
            <dd>{formatDate(row.requestedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Progress</dt>
            <dd>
              {row.progress
                ? `${row.progress.completedLessons}/${row.progress.totalLessons} lessons · ${formatDuration(row.progress.secondsWatched)} watched`
                : row.seats
                  ? `${row.seats.redeemed} of ${row.seats.total} seats redeemed`
                  : "—"}
            </dd>
          </div>
        </dl>

        <div className="text-sm">
          <p className="text-muted-foreground">Reason</p>
          <p className="whitespace-pre-wrap">{row.reason}</p>
        </div>

        {row.declineReason && (
          <div className="text-sm">
            <p className="text-muted-foreground">
              Decline reason
              {row.decidedAt ? ` (${formatDate(row.decidedAt)})` : ""}
            </p>
            <p className="whitespace-pre-wrap">{row.declineReason}</p>
          </div>
        )}

        {row.seatBreakdown && (
          <div className="text-sm">
            <p className="mb-1 text-muted-foreground">Seat breakdown</p>
            <SeatBreakdown seats={row.seatBreakdown} />
          </div>
        )}

        <RowActions row={row} />
      </CardContent>
    </Card>
  );
}

// ─── New refund ───

function NewRefund({ purchases }: { purchases: PurchaseWithoutRefundRequest[] }) {
  const [selectedId, setSelectedId] = useState<string>("");
  const selected = purchases.find(
    (purchase) => String(purchase.purchaseId) === selectedId
  );

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="text-lg font-semibold">New refund</h2>
          <p className="text-sm text-muted-foreground">
            Create an approved refund for a purchase that has no refund request.
            This waives only the refund window; the progress limits still apply.
          </p>
        </div>

        {purchases.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every purchase already has a refund request.
          </p>
        ) : (
          <div className="flex flex-wrap items-start gap-3">
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className="w-full sm:w-[28rem]">
                <SelectValue placeholder="Choose a purchase…" />
              </SelectTrigger>
              <SelectContent>
                {purchases.map((purchase) => (
                  <SelectItem
                    key={purchase.purchaseId}
                    value={String(purchase.purchaseId)}
                  >
                    {purchase.purchaserName} · {purchase.courseTitle} ·{" "}
                    {formatPrice(purchase.amountPaid)}
                    {purchase.seats ? ` · ${purchase.seats.total} seats` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {selected && <NewRefundDetails purchase={selected} />}
      </CardContent>
    </Card>
  );
}

function NewRefundDetails({
  purchase,
}: {
  purchase: PurchaseWithoutRefundRequest;
}) {
  const quote = purchase.quote;
  const isTeam = purchase.seats !== null;

  return (
    <div className="space-y-3 rounded-md border p-4 text-sm">
      <p>
        {purchase.purchaserName}{" "}
        <span className="text-muted-foreground">{purchase.purchaserEmail}</span>{" "}
        bought {purchase.courseTitle} on {formatDate(purchase.purchasedAt)} for{" "}
        {formatPrice(purchase.amountPaid)} ({describeSeats(purchase.seats)}).
      </p>
      {quote.refundable ? (
        <p>Refund amount: {formatPrice(quote.amount)}</p>
      ) : (
        <p className="text-muted-foreground">
          Cannot be refunded: {quote.reason}
        </p>
      )}
      <ConfirmAction
        key={purchase.purchaseId}
        trigger="Create refund…"
        triggerVariant="default"
        title="Create an approved refund"
        confirmLabel={
          quote.refundable
            ? `Approve ${formatPrice(quote.amount)} refund`
            : "Approve refund"
        }
        disabled={!quote.refundable}
        fields={{ intent: "new-refund", purchaseId: String(purchase.purchaseId) }}
        reason={{
          label: "Reason",
          placeholder: "Why is this refund being given?",
        }}
      >
        {quote.refundable && (
          <>
            <p>
              The refund request is created already approved.{" "}
              {purchase.purchaserName} will get {formatPrice(quote.amount)}{" "}
              back and will be emailed.
            </p>
            {quote.affectedStudents.length > 0 && (
              <p>
                {joinNames(quote.affectedStudents.map((s) => s.name))} will be
                read-only until the refund is issued
                {isTeam ? ", and will be emailed" : ""}.
              </p>
            )}
            {isTeam && (
              <p>The refunded seat codes can no longer be redeemed.</p>
            )}
            {quote.seatBreakdown && (
              <SeatBreakdown seats={quote.seatBreakdown} />
            )}
            <p>
              Approval is final: afterwards the refund can only be marked
              issued or failed.
            </p>
          </>
        )}
      </ConfirmAction>
    </div>
  );
}

// ─── Page ───

export default function AdminRefundRequests({
  loaderData,
}: Route.ComponentProps) {
  const { filter, refundRequests, purchases } = loaderData;
  const fetcher = useFetcher<typeof action>({ key: ACTION_FETCHER_KEY });

  // Toasts live here: the row that submitted may leave the list on success.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && "ok" in fetcher.data) {
      toast.success(fetcher.data.message);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund Requests</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Review refund requests and record what happened to the money
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {FILTER_TABS.map((tab) => (
          <Link
            key={tab.value}
            to={`?status=${tab.value}`}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              tab.value === filter
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {refundRequests.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <ReceiptText className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              No refund requests match this filter.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {refundRequests.map((row) => (
            <RefundRequestCard key={row.id} row={row} />
          ))}
        </div>
      )}

      <div className="mt-10">
        <NewRefund purchases={purchases} />
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading refund requests.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "Only admins can access this page.";
    } else if (error.status === 409) {
      title = "That action is no longer possible";
      message = typeof error.data === "string" ? error.data : error.statusText;
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
          <Link to="/admin/refund-requests">
            <Button>Back to Refund Requests</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
