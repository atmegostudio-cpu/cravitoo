# Cravitoo · Developer Interview Questions

*47 questions to ask an outside software developer before you hire them — plus how to run the meeting and what red flags to walk away from.*

---

## How to use this document

Ask these questions in the order below. Their answers tell you if the developer is competent, trustworthy, and worth hiring — **before** you hand over a single credential.

- **Meeting 1 (~45 min):** Questions 1–15 + 40–47 → decide if you like them as a person and if their technical baseline is real.
- **Meeting 2 (~30 min, only if Meeting 1 goes well):** Questions 16–39 + walk them through the app + hand over the Developer Handover Q&A and Bugs & Security Q&A PDFs.
- **Then wait 24 hours.** Don't commit on the spot. Talk to references. If everything checks out, send the NDA + contract on Day 3.

---

## 🧑‍💼 Section 1 — Background & credibility

**Q1. How many years of full-stack experience do you have — split by frontend, backend, and mobile?**

**Q2. Show me 2–3 past projects with a live URL or Play Store link.**
*(No live link = red flag.)*

**Q3. What was your specific role on those projects — solo builder, lead, or team member?**

**Q4. Can you give me two references from past clients I can call this week?**

**Q5. Are you a freelancer, a small agency, or moonlighting from a full-time job?**
*(Moonlighters ghost more often — plan for it.)*

**Q6. Are you based in India? What's your time zone and typical working hours?**

**Q7. Have you worked on any food-tech, corporate SaaS, or multi-tenant apps before?**

---

## 🛠️ Section 2 — Technical fit (Cravitoo-specific)

**Q8. How comfortable are you with FastAPI + MongoDB (Motor) + JWT auth?**
*(Ask them to describe how they'd add a rate-limiter to `/auth/login` — a 2-minute answer tells you everything.)*

**Q9. How comfortable are you with React 19 + TailwindCSS + Shadcn?**

**Q10. Have you shipped a React Native app to the Play Store using EAS Build? How many?**

**Q11. Have you worked with Razorpay integration and webhook signature verification?**

**Q12. Do you know how to use Emergent's platform, or will you need me to walk you through Save-to-GitHub / Re-publish?**

**Q13. Have you set up GitHub Actions for CI/CD (running pytest + Playwright on PRs)?**

**Q14. Can you explain the difference between an access token and a refresh token in one minute?**
*(Basic auth literacy check.)*

**Q15. What's your approach to writing tests — do you write them alongside the code, before, or after?**

---

## 🔒 Section 3 — Security awareness

**Q16. How would you rotate `JWT_SECRET` in production without logging everyone out?**

**Q17. Where do you usually store API keys during development?**
*(Correct answer: `.env` + password manager. Wrong: "in the code" or "in Slack".)*

**Q18. Have you handled OWASP Top 10 vulnerabilities before? Give me an example of one you fixed.**

**Q19. What's your first move if a client tells you their production database is compromised?**

**Q20. Do you use 2FA on all your work accounts?**

---

## 💰 Section 4 — Commercials

**Q21. What's your hourly rate, retainer, or fixed-project rate?**

**Q22. Do you invoice with GST?**
*(Important for your books if they're in India.)*

**Q23. What's your payment cycle — weekly, bi-weekly, monthly, milestone-based?**

**Q24. Do you require an advance? How much?**
*(50% advance is normal for small projects; 100% is a red flag.)*

**Q25. What happens if a bug you introduce breaks production — free fix or billable?**
*(Correct: free fix within warranty period, usually 30 days.)*

**Q26. Do you charge for meetings and status calls?**

---

## 🕐 Section 5 — Availability & delivery

**Q27. How many hours per week can you dedicate to Cravitoo?**

**Q28. Are you working with other clients simultaneously?**
*(Not necessarily bad — but be honest about it.)*

**Q29. What's your typical response time to a P0 production issue at 11 PM?**

**Q30. What's your realistic estimate to ship the Mobile Play Store rebuild (Item #1 on my backlog)?**
*(Compare with your own gut. Wildly optimistic = red flag.)*

**Q31. How do you handle vacation / sick days — will you have backup coverage?**

---

## 🤝 Section 6 — Process & collaboration

**Q32. How do you prefer to communicate — Slack, WhatsApp, email, GitHub Issues?**

**Q33. Will you write a daily or weekly status update?**

**Q34. How do you estimate work — story points, hours, gut feel?**

**Q35. Do you use a task tracker (Linear / Notion / GitHub Issues), or want me to set one up?**

**Q36. How do you handle scope changes? What if I ask for a feature mid-sprint?**

**Q37. What's your PR review process — do you self-review before requesting mine?**

**Q38. Do you push directly to `main`, or always work in branches with PRs?**
*(Correct: branches + PRs. Anyone who pushes to main directly is a hard pass.)*

---

## 📄 Section 7 — Legal & handover

**Q39. Will you sign an NDA before I share anything sensitive?**

**Q40. Are you comfortable with a "work-for-hire" agreement where all IP belongs to me?**

**Q41. Do you require a contract before starting, or will a Statement of Work do?**

**Q42. What happens to the code if we part ways — do you retain any copy?**
*(Correct answer: no, they wipe local copies and revoke access.)*

**Q43. Will you document what you build so I'm not locked into you?**

---

## 🚦 Section 8 — Soft signals to watch for

**Q44. What questions do YOU have for me?**
*(A great developer will have 10+ questions. A bad one will just say "when do I start?")*

**Q45. What's the last technical mistake you made in production and how did you handle it?**
*(Anyone who says "I don't make mistakes" is lying — walk away.)*

**Q46. What's your favourite way to keep learning?**
*(Newsletters, GitHub, YouTube, courses — any answer is fine except "I don't need to.")*

**Q47. Why are you interested in Cravitoo specifically vs any other project?**
*(If they can't articulate why beyond "money", their engagement will be shallow.)*

---

## 🚩 Red-flag summary — walk away if ANY of these happen

- 🚩 They ask for 100% advance
- 🚩 They can't show any live URL
- 🚩 They push back on signing an NDA
- 🚩 They refuse to work in branches / PRs
- 🚩 They don't use 2FA
- 🚩 They say "I've never made a mistake"
- 🚩 They quote a suspiciously low OR suspiciously high price for the market
- 🚩 They can't articulate a security concept in plain language
- 🚩 They dismiss testing as unnecessary
- 🚩 They want your master admin credentials on day one
- 🚩 References go quiet or take days to respond
- 🚩 They talk over you or dismiss your questions

---

## ✅ Green flags — hire them if you see these

- ✅ Comes to Meeting 1 with 5+ questions of their own
- ✅ Asks to see the code before committing to a rate
- ✅ Volunteers to sign the NDA before you ask
- ✅ Suggests starting with a paid trial task (1–2 days)
- ✅ Has a public GitHub with recent commits
- ✅ Comfortable saying "I don't know, let me check" instead of bluffing
- ✅ Talks about tests, PR reviews, and CI without you bringing it up
- ✅ Has a portfolio site or Calendly link (signs of a professional operation)
- ✅ Suggests a fixed-scope trial for a specific bug fix first, then retainer

---

## 🎬 The 10-minute rating card

After each meeting, score them 1–5 on these five dimensions. Anyone below 3 on any single line is a NO.

| Dimension | Score (1–5) |
|---|---|
| Technical depth (React / Python / mobile) | |
| Security awareness | |
| Communication clarity | |
| Curiosity — asks good questions | |
| Trust — feels like they respect your time & money | |

**Total ≥ 20 / 25** → hire on a small paid trial task
**15–19 / 25** → get a second opinion, or move on
**< 15 / 25** → next candidate

---

*Cravitoo · Developer Interview Pack · v1.0 · Feb 2026*
