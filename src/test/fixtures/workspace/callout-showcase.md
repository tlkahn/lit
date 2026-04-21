---
title: Callout Showcase
tags:
- test
- reference
type: reference
---

# Callout Showcase

Every supported callout type in one file.

> [!note] Note
> Standard note for general information.

> [!tip] Tip
> Helpful advice or best practices.

> [!warning] Warning
> Something that could cause problems.

> [!danger] Danger
> Critical issue requiring immediate attention.

> [!info] Info
> Supplementary background context.

> [!success] Success
> A positive outcome or confirmation.

> [!failure] Failure
> Something that went wrong.

> [!bug] Bug Report
> A known issue or defect.

> [!example] Example
> A concrete illustration of a concept.

> [!quote] Quote
> Words from someone else.

> [!question] Question
> Something to investigate further.

> [!abstract] Abstract
> A high-level summary or overview.

> [!todo] Todo
> - [ ] Item one
> - [ ] Item two

## Aliases

These resolve to their canonical types.

> [!summary] Summary (alias for abstract)
> This renders the same as an abstract callout.

> [!tldr] TL;DR (alias for abstract)
> Short version of a longer piece.

> [!check] Check (alias for success)
> Verified and confirmed.

> [!done] Done (alias for success)
> Task completed.

> [!hint] Hint (alias for tip)
> A subtle pointer in the right direction.

> [!important] Important (alias for tip)
> Pay extra attention here.

> [!attention] Attention (alias for warning)
> Heads up about something.

> [!caution] Caution (alias for warning)
> Proceed carefully.

> [!fail] Fail (alias for failure)
> Did not meet expectations.

> [!missing] Missing (alias for failure)
> Expected content not found.

> [!error] Error (alias for danger)
> A serious problem occurred.

> [!cite] Cite (alias for quote)
> A referenced source.

## Fold States

> [!note]+ Expanded by Default
> This callout starts open and can be collapsed.

> [!note]- Collapsed by Default
> This callout starts closed and can be expanded.

> [!warning]- Collapsed Warning
> Hidden until the reader clicks to expand.

## Callout with No Custom Title

> [!bug]
> When no title is given, the callout type name becomes the title.

## Nested Content

> [!example] Rich Content Inside
> Callouts can contain **bold**, *italic*, `code`, and [[Widget Theory|links]].
>
> They can also contain math: $E = mc^2$
>
> And even lists:
> - First item
> - Second item
