# Refund amounts are based on the Amount Paid and stored as a promise

A refund is always worked out from the Purchase's **Amount Paid**, never the current Course Price. The result is stored on the Refund Request: for a self-service request when it is submitted, and for a Refund Override when the Admin approves. A promise we have told the Purchaser about must not change later because of a price change or new Lesson Progress.

For a Team Purchase that has Redeemed seats, the refund is `Amount Paid − seat price × seats that cannot be refunded`, where `seat price = Amount Paid ÷ seats`. A seat cannot be refunded if its holder completed the course or is over the progress limits. Because the deduction is subtracted from the total, any rounding remainder in cents goes to the Purchaser. The per-seat breakdown is stored with the amount. A Refund Override waives only the Refund Window and never the progress limits. That way one rule covers individual and team purchases, and the Admin's discretion has a limit.

## Considered Options

- **Current Course Price** (the original code for full-price purchases): rejected. Price changes would make refunds bigger or smaller than what was paid, and it was wrong for multi-seat purchases.
- **Recalculate when the Admin decides**: rejected for self-service requests. The Student is read-only while the request is Open, and the amount they were shown is the amount we owe.
- **Full refund for teams with redeemed seats**: rejected. It would refund value that seat holders have already used.
- **Unlimited Admin override, including progress**: rejected. It would give individuals more than teams, and it is too generous.
