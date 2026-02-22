---
allowed-tools: Bash(gh *),Bash(bun *),Bash(git *)
description: Fetch unresolved PR review comments, implement fixes, reply, commit, and push
---

You are helping implement fixes for unresolved PR review comments. Follow these steps in order:

## 1. Fetch PR info and comments

Run in parallel:
- `gh pr view --json number,headRepository,headRefName`
- `gh api /repos/{owner}/{repo}/pulls/{number}/comments` — review comments (inline)
- `gh api /repos/{owner}/{repo}/issues/{number}/comments` — top-level comments

Identify the **owner/repo** from `gh repo view --json nameWithOwner -q .nameWithOwner`.

## 2. Identify unresolved comments

A comment is **unresolved** if it has no reply (no other comment with `in_reply_to_id` pointing to it, and it is not itself a reply). Focus only on unresolved threads.

If the user provided additional context (e.g. a specific review or subset of comments), filter to those.

## 3. Plan fixes

Before coding, list each unresolved comment with:
- File and line reference
- What the reviewer asked for
- Your intended fix (one sentence)

For "consider" suggestions, apply judgment based on project guidelines (simplicity first, no speculative abstractions). If genuinely ambiguous, apply the simpler option and note the tradeoff in your reply.

## 4. Implement fixes

For each unresolved comment:
- Read the relevant file(s) first
- Make the minimal change that satisfies the reviewer
- Run `bun run test` after all changes — all tests must pass before continuing

## 5. Verify

- `bun run build` — must succeed
- `bun run test` — 0 failures

## 6. Reply to each resolved comment on GitHub

For each comment you fixed, post a reply using:
```
gh api /repos/{owner}/{repo}/pulls/{number}/comments \
  --method POST \
  --field body="..." \
  --field in_reply_to={comment_id} \
  --jq '.id'
```

Reply should be concise: what you did and why (1-3 sentences). Match the tone of existing replies in the thread.

## 7. Commit and push

Stage only the files changed by your fixes:
```
git add <specific files>
git commit -m "<imperative summary under 72 chars>"
git push
```

Commit message should summarize all fixes in one line. Follow the project's commit style (imperative mood, no "wip", no "updates").

---

## Rules

- Never commit before all tests pass
- Never reply to a comment before the fix is implemented and tested
- Only touch files needed for the fixes — no unrelated cleanup
- If a fix would require breaking changes or significant API redesign, note it in your reply instead of implementing it, and ask the user
