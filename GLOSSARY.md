# Course Platform Glossary

Shared business vocabulary for the application. Each term has a distinct meaning; the same person can be a User, Student, and Purchaser in different contexts.

## People and roles

**User**:
A person with an application account, regardless of whether they purchase, study, or teach a course.

**Student**:
A person taking a course. Being a Student does not imply that they purchased their own access.
_Avoid_: Learner as a competing name for the same person.

**Purchaser**:
A User who buys course access for themselves or seats for others. A Purchaser is not necessarily a Student on the course they purchased.
_Avoid_: Buyer; Customer when specifically referring to the person who made a Purchase.

**Instructor**:
A person responsible for creating and managing a course and supporting its Students.

**Admin**:
A person with application-wide administrative responsibilities, including managing Users, courses, and categories.
_Avoid_: Team Admin when referring to an application-wide Admin.

**Course Staff**:
The course's Instructor and application Admins, who can manage or support that course.

**Team Admin**:
A User responsible for managing a Team's purchased seats and Seat Codes. This responsibility is distinct from being an application Admin.

## Courses and learning

**Course**:
A learning offering organized into modules and lessons and managed by an Instructor.

**Category**:
A classification used to organize courses by subject or topic.

**Module**:
An ordered group of lessons within a Course.

**Lesson**:
An individual learning unit within a Module, which may include written content, video, supporting resources, or a Quiz.

**Enrollment**:
A Student's relationship with a Course, established through their own Purchase or redemption of a Seat Code. Enrollment is distinct from both a Purchase and permission to access particular content.

**Content Access**:
Permission to view a Course's protected learning content. Enrollment and any applicable access restrictions determine a Student's access; Course Staff can have access without Enrollment.

**Lesson Progress**:
A Student's learning status for a Lesson: Not Started, In Progress, or Completed.

**Course Progress**:
The proportion of a Course's lessons that a Student has marked Completed. This measure is distinct from a separate declaration that the Course is complete.

**Quiz**:
A Lesson assessment consisting of questions with selectable answers.

**Quiz Attempt**:
A Student's submission of answers to a Quiz, together with its score and pass result.

**Rating**:
A Student's one-to-five-star assessment of a Course in which they are enrolled.
_Avoid_: Review when referring only to a star Rating rather than written feedback.

**Discussion**:
A Lesson's conversation area, containing comments and replies from people with Content Access.

**Unanswered Question**:
A Student's top-level Discussion comment that has not received a reply from Course Staff. A reply from another Student does not make it answered for this purpose.

**Sales Copy**:
The promotional description of a Course, distinct from its learning content.

## Purchases, teams, and pricing

**Purchase**:
An acquisition of access to a particular Course, either for the Purchaser or as seats for others. A Purchase records the Amount Paid and is distinct from Enrollment.

**Team Purchase**:
A Purchase of one or more seats for a Course, distributed using Seat Codes. It does not automatically enroll the Purchaser.

**Team**:
A group through which a Purchaser manages purchased seats and their Seat Codes. Redeeming a Seat Code establishes Enrollment, not necessarily Team membership.

**Seat**:
One prepaid place for one person on one specific Course.
_Avoid_: License when it could suggest platform-wide or concurrent access.

**Seat Code**:
A single-use code granting its recipient a purchased Seat when redeemed.
_Avoid_: Coupon, Coupon Code, Discount Code; these suggest a price reduction rather than prepaid course access.

**Redeem**:
Use a Seat Code to enroll in its Course.
_Avoid_: Claim as a competing name for this action.

**Redeemed**:
The state of a Seat Code that has been used to establish Enrollment.
_Avoid_: Claimed as a competing name for this state.

**Course Price**:
The advertised base price of a Course before applicable pricing adjustments. It is distinct from the Amount Paid for a particular Purchase.

**Amount Paid**:
The total paid for a particular Purchase after applicable pricing adjustments, including all seats in a Team Purchase.
_Avoid_: Current Course Price when referring to the historical amount paid.

**Purchasing Power Parity (PPP)**:
Country-based pricing that offers reduced Course prices according to purchasing-power differences, where enabled for a Course.

**Purchase Country**:
The Purchaser's detected country at the time of a Purchase. It is distinct from nationality and Current Country.

**Current Country**:
The country detected for a User's current visit, used where geographic pricing or access rules apply.

## Refund requests and refunds

**Refund Request**:
A request to return money paid for a Purchase, accompanied by a reason and subject to review. It is not itself a Refund and does not mean that money has been sent or Content Access has ended.
_Avoid_: Cancellation, Reversal, Chargeback; Refund when referring to the request rather than the return of money.

**Open Refund Request**:
A Refund Request awaiting a decision.
_Avoid_: Pending, Pending Chargeback, Requested as competing status names; use “Refund request awaiting review” for explanatory wording.

**Approved Refund Request**:
A Refund Request accepted for a return of money. Approval is a decision, not confirmation that the Refund has been issued.

**Declined Refund Request**:
A Refund Request rejected during review. No Refund is authorized by that decision.

**Refund**:
A return of money paid for a Purchase, following an Approved Refund Request. Its payment status is separate from the decision on the Refund Request.
_Avoid_: Cancellation, Reversal, Chargeback.

**Pending Refund**:
An approved return of money that has not yet been sent.
_Avoid_: Pending Refund Request when the review decision has already been made.

**Issued Refund**:
A Refund for which the money has been sent, although it may not yet appear in the recipient's account.
_Avoid_: Received when only sending has been confirmed.

**Failed Refund**:
A Refund for which an attempt to send the money failed. The associated Refund Request remains Approved.
_Avoid_: Declined Refund Request when the failure concerns payment rather than the review decision.

**Refund Window**:
The 14 days after a Purchase during which the Purchaser may submit a Refund Request themselves.

**Refund Eligibility**:
The conditions under which a Purchaser may submit a Refund Request themselves: within the Refund Window, below the progress limits, no Redeemed seats, and no earlier Issued Refund for that Course.

**Read-only Access**:
Content Access limited to Lessons the Student has already Completed, with no new Lesson Progress, Quiz Attempts, Discussion comments, or Ratings. It applies while a Refund affecting the Student's Enrollment is in progress.
_Avoid_: Frozen, Suspended.

**Revoked Enrollment**:
An Enrollment whose Content Access ended because a Refund was Issued. Its Lesson Progress is kept so the Enrollment can be restored.
_Avoid_: Cancelled Enrollment, Deleted Enrollment.

**Refund Override**:
An Admin's approval of a refund that the Refund Eligibility rules would not allow, either by approving a Declined Refund Request or by creating one on the Purchaser's behalf. It waives only the Refund Window.
_Avoid_: Manual Refund, Exception.

**Refundable Seat**:
A Seat in a Team Purchase that is not Redeemed, or whose holder is below the progress limits for its Course.

**Chargeback**:
A payment dispute raised by a cardholder through their bank or card issuer, distinct from a Refund Request made to the course provider.
_Avoid_: Chargeback as a name for a Refund Request or a Refund.
