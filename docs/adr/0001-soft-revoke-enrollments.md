# Issued Refunds soft-revoke the Enrollment instead of deleting it

When a Refund is Issued, the Student loses Content Access by setting `revokedAt` on their Enrollment rather than deleting the row. We chose this because access must be restorable: buying the course again or an Admin "Restore access" brings back the old Lesson Progress, and we keep history for analytics and Discussions. The cost is that every Enrollment query must ignore revoked rows. Do not "simplify" this to a `DELETE`.

## Considered Options

- **Delete the Enrollment row**: keeps queries simple, but loses the link to Lesson Progress, Quiz Attempts, Ratings and comments, and makes restoring access impossible.
- **Soft-revoke with `revokedAt`** (chosen): restoring access is a single update. Enrollment-based queries must ignore revoked rows, so they should go through a shared helper.
