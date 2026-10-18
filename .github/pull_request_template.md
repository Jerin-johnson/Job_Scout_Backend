## Summary

<!-- What changed and why? -->

## Verification

- [ ] npm run lint
- [ ] npm run docs:check
- [ ] npm test (includes mongodb-memory-server integration tests)
- [ ] AI eval results included if a prompt or score changed

## Safety and operations

- [ ] Docs updated in the same change
- [ ] No secrets, prompts, resume text, answers, or presigned URLs in logs/docs
- [ ] User-owned queries remain ownership scoped and cross-user access returns 404
- [ ] Migrations are additive with report/rollback; no unapproved production migration
- [ ] No dependency or infrastructure added without approval
- [ ] AI pages separate verified behavior from target design; unknowns marked Unverified

## UI changes (if applicable)

- [ ] Screenshots at 375px, 768px, and 1280px in light and dark themes
- [ ] Keyboard, focus, screen reader, contrast, and touch checks completed
