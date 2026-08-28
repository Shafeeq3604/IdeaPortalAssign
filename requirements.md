# Idea Innovation Platform — Simplified Product Requirements

1. Product Goal

Build a simple, friendly internal website where employees can easily share ideas that could improve the organization.

The platform should make submitting an idea feel as easy as sending a message.

Core principle:

Employees provide the idea. The platform helps understand and evaluate it, and colleagues react to it. Humans make important decisions.

Priorities:

Ease of use

Simple navigation

Minimal forms

Clear language

Fast submission

Useful feedback

Transparent evaluation

Human oversight

Avoid making the platform feel like a complex enterprise management system.

2. Employee Experience

The employee should not need to understand evaluation criteria, business scoring, AI models, technical feasibility, implementation planning, ranking algorithms, or data models.

They should simply:

Open the website.

Click "Submit an Idea."

Choose how to provide it.

Submit it.

See what the platform understood.

Optionally answer a few questions.

Track the idea later.

3. Idea Submission

Provide three simple choices.

Write an Idea

Idea title — Optional

Idea description — Required

Additional information — Optional

Main prompt:

Tell us about your idea.

Upload a File

MVP-supported formats:

PDF

DOCX

TXT

The platform validates the file, extracts text, and processes it automatically.

Paste Text

Allow users to paste an idea from email, notes, documents, or another source.

4. Submission UX

Example:

Submit Your Idea

Have an idea that could improve the organization?

Choose how you'd like to share it:

[ Write an Idea ]

[ Upload a File ]
PDF • DOCX • TXT

[ Paste Text ]

Only show fields relevant to the selected method.

Do not force employees to complete a long form.

5. Optional Information

Do not require employees to provide:

Business impact

Implementation cost

Technical requirements

Dependencies

Risks

Department impact

Estimated timeline

Required resources

Technologies

Alternatives

These can be discovered later by the platform or reviewers.

6. AI in the Background

AI may help identify:

What the idea is

What problem it appears to solve

Who might benefit

Potential benefits

Possible use cases

Relevant departments

Possible risks

Implementation considerations

Similar ideas

Missing information

Normal employees should not see technical AI terminology such as embeddings, vector search, LLM routing, prompt chains, RAG pipelines, or model orchestration.

7. Clarification

If more information is useful, ask only a few simple questions.

Example:

We understand your idea.

To help us evaluate it better:

Who would benefit from this?
[ Your answer ]

What problem does this solve today?
[ Your answer ]

[ Continue ]

Optional questions should be skippable. Never turn clarification into another long form.

8. Idea Confirmation

Before continuing, show the employee a simple summary:

Here's what we understood

Idea:
AI assistant for HR questions

Problem:
Employees spend time contacting HR for common questions.

Potential benefit:
Faster access to HR information.

[ Edit ] [ Confirm ]

This gives the employee control over AI interpretation.

9. Idea Details Page

Keep this as the main place for tracking an idea.

Sections:

Idea: title, description, date, status

What We Understood: problem, proposed solution, potential benefit

Evaluation: overall score/status, short explanation, strengths, concerns

Feedback: reviewer comments, questions, responses

Next Step: one clear next action

Avoid displaying too much information at once.

10. Simple Idea Status

Employee-facing statuses:

Submitted

Being Reviewed

Needs More Information

Under Consideration

Selected for Further Investigation

In Progress

Completed

Not Proceeding

Internal workflows may contain more detailed states, but users should see simple language.

11. Evaluation

The platform can still evaluate ideas across:

Business value

Feasibility

Effort

Time-to-value

Risk

Strategic alignment

Adoption potential

User-facing presentation should be simple.

Example:

Overall Opportunity
82 / 100

High potential business value
Good feasibility
Moderate implementation effort
Strong alignment
Some technical dependencies

Use "See why" for more detail.

12. Ranking

Ranking should not dominate the employee experience or make idea submission feel like a competition.

For employees, prefer messages such as:

Your idea is being considered.

Your idea has high potential.

Your idea has been selected for further investigation.

Authorized managers and innovation teams can access detailed rankings.

13. Ranking Dashboard

For managers/reviewers show:

Top ideas

Overall score

Business value

Feasibility

Effort

Status

Recommended visualizations:

Ranked list / horizontal bar chart

Impact vs Effort matrix

Score breakdown for a selected idea

Do not display every chart simultaneously.

14. Reactions

Ideas are for sharing and reacting to, not for critiquing.

Any employee viewing an idea can give it a thumbs up or a thumbs down, and the totals are
visible at a glance. A reaction is an opinion from a colleague, shown next to — and clearly
apart from — the platform's own evaluation.

Popularity must not directly determine the ranking. The two are separate signals and are
labelled as such:

- AI Evaluation — the platform's score, with its reasoning
- Team Feedback — what colleagues think

Removed: the platform previously suggested how an author could make their idea stronger.
That has been withdrawn. It made the experience read as a critique of the person's idea,
and this platform is for posting ideas and seeing how people respond to them. The
evaluation still explains its score; it no longer tells anyone what to change.

15. Duplicate and Related Ideas

If a similar idea exists, show:

We found a similar idea.

Options:

View similar idea

Link your idea

Combine ideas

Continue with your idea

Do not expose similarity/AI technical details.

16. Collaboration

MVP:

Comments

Reviewer feedback

Questions

Responses

Basic notifications

Later:

Upvotes

Endorsements

Suggested collaborators

Idea merging

Team collaboration

Popularity should not directly determine the final ranking.

17. Employee Dashboard

Show:

My ideas

Idea status

Submission date

Latest update

Feedback

Quick action: Submit a New Idea

Keep analytics out of the employee dashboard unless genuinely useful.

18. Manager / Reviewer Dashboard

Show:

Ideas requiring review

High-potential ideas

Ideas needing clarification

Ideas by status

Basic score information

Recent activity

Filters:

Department

Status

Category

Date

Score

19. Leadership / Innovation Dashboard

For authorized users:

Top opportunities

Impact vs effort

Potential business value

Feasibility

Investment requirements

Ideas in progress

Realized outcomes

20. Navigation

Keep the main navigation small:

Dashboard
Submit Idea
Explore Ideas
My Ideas

For authorized users:
Reviews
Rankings
Administration

Do not put every feature in the main navigation.

21. Explore Ideas

Show permitted ideas using simple cards:

Title

Short description

Category

Status

Potential value

Related ideas

Provide search and filters.

22. Security and Privacy

Support:

Authentication

Email and password. People can create their own account; an administrator can also
create one for them. A self-created account is always an ordinary employee — the
sign-up form has no way to ask for anything more.

Registration can be limited to the organisation's own email domains, and can be turned
off entirely, in which case accounts are created by an administrator only.

Role-based access

An administrator grants every role above employee, and every grant is on the audit
trail with their name against it. Nobody promotes themselves.

The one exception is the very first administrator on a brand-new installation, who can
be created with a one-off invite code. That code stops working the moment an
administrator exists, and never works again.

Accounts are deactivated, never deleted, because the audit trail refers to them. An
administrator cannot deactivate themselves or drop their own last administrator role.

Appropriate idea visibility

Private/confidential ideas

Secure file uploads

Encryption

Audit logs

Data retention

Secure AI processing

Security controls should be mostly invisible to normal users.

23. AI Safety

Treat uploaded documents and submitted text as untrusted input.

Protect against:

Prompt injection

Malicious files

Incorrect AI assumptions

Hallucinations

Sensitive information exposure

AI-generated information is an assessment, not automatically truth. Important decisions require human review.

24. High-Level System Flow

Employee
    ↓
Submit Idea
    ↓
Write / Upload / Paste
    ↓
Process Content
    ↓
AI Understands Idea
    ↓
Optional Clarification
    ↓
Employee Confirms
    ↓
Evaluation
    ↓
Ranking / Prioritization
    ↓
Human Review
    ↓
Further Investigation
    ↓
Prototype / Implementation
    ↓
Measure Outcome

The user should experience this as a simple process even if the backend is more sophisticated.

25. High-Level Technical Principle

Keep the first implementation straightforward.

Separate:

Frontend

Backend/API

Database

File processing

AI processing

Scoring

Search

Do not introduce complex infrastructure unless the product actually requires it.

For the initial version:

Use a straightforward web application

Use background processing only where necessary

Store structured idea information in the database

Store uploaded files securely

Use AI only where it provides meaningful value

Use deterministic logic for scoring and ranking

Add advanced infrastructure only when justified

26. AI Token Efficiency

Never send the entire database to an AI model.

For an individual idea, use only:

Submitted idea

Relevant structured information

Relevant similar ideas

Relevant approved organizational information

The database/application should handle:

Search

Filtering

Sorting

Pagination

Aggregation

Ranking

AI should handle:

Understanding

Summarization

Extraction

Reasoning

27. Large Dataset Support

The system should be capable of growing from 10 to 100,000+ ideas, but the MVP should not be over-engineered for the largest scale.

For the MVP:

Paginate idea lists

Search using database indexes

Filter on the backend

Calculate charts from aggregated data

Process AI tasks asynchronously when needed

Add advanced infrastructure only when actual scale requires it.

28. Data Model

Keep the initial data model focused.

MVP:

User

Department

Idea

Idea Version

Attachment

AI Analysis

Evaluation

Review

Comment

Notification

Audit Event

Later:

Experiment

Prototype

Project

Outcome

Advanced dependencies

Resource planning

Do not build every future entity into the first release.

29. MVP

Employee

Create an account

Sign in and sign out

Submit an idea

Write an idea

Upload PDF/DOCX/TXT

Paste text

View submitted ideas

View idea status

Confirm/edit AI understanding

Answer optional clarification questions

View feedback

Platform

File validation

Text extraction

AI idea understanding

Simple structured summary

User-provided vs AI-inferred distinction

Basic duplicate/related idea detection

Evaluation

Explainable score

Thumbs up / thumbs down reactions

Administrator

Add someone and set their roles

Change roles, set a department, reset a password, deactivate an account

Reviewer

View ideas

Review AI assessment

Add feedback

Change status

Request information

Approve/decline further investigation

Dashboard

Employee dashboard

Reviewer dashboard

Basic ranking

Basic impact/effort visualization

30. V2

Consider:

Advanced collaboration

Idea merging

Expert matching

Improved semantic search

RAG over approved internal documentation

Prototype tracking

Pilot tracking

Advanced analytics

Notifications

Integrations

Historical outcome analysis

31. V3

Only after sufficient usage and historical data:

Advanced forecasting

Organization-specific evaluation models

Portfolio optimization

Resource recommendations

Automated opportunity discovery

Advanced strategic planning

Enterprise innovation intelligence

32. What NOT to Build Initially

Avoid unless there is a real requirement:

Complex multi-agent AI systems

Multiple AI models for every operation

Advanced vector infrastructure

Complicated workflow engines

Extensive gamification

Complex voting systems

Large numbers of dashboard charts

Automated financial forecasting

Fully automated decision-making

Detailed resource planning

Portfolio optimization

First prove that employees will use the platform and that organizations receive useful ideas.

33. Design Philosophy

Simple on the outside, intelligent on the inside.

Employees should see:

Submit
   ↓
Understand
   ↓
Review
   ↓
Track

The platform can internally perform extraction, classification, AI analysis, duplicate detection, evaluation, scoring, ranking, and human review.

The complexity belongs behind the interface, not in front of the user.

34. Success Metrics

Focus on:

Active contributors

Ideas submitted

Repeat contributors

Submission completion rate

Time from submission to initial review

Review participation

Clarification rate

Duplicate detection usefulness

Ideas selected for investigation

Ideas reaching prototype

Ideas reaching implementation

Realized business value

User satisfaction

Submission time

Drop-off during submission

The most important MVP question is:

Will employees actually use this because it is easier than the current way they share ideas?

35. Final Product Definition

The platform is an easy-to-use internal website where employees can submit an idea by:

Writing it

Uploading a PDF

Uploading a DOCX

Uploading a TXT

Pasting text

The employee should not have to create a formal business proposal.

The platform then:

Understands the idea.

Creates a simple structured summary.

Asks for clarification only when useful.

Checks for similar ideas.

Evaluates the idea.

Explains its potential.

Allows human reviewers to provide feedback.

Tracks progress.

Measures outcomes for implemented ideas.

36. Most Important Product Rule

Do not make the user interact with the complexity of the system.

The employee-facing experience should ultimately feel like:

"I have an idea. Let me tell the organization about it."

That is the foundation of the website.