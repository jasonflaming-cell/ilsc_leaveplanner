# Annual Leave Planner (No-Auth, Vercel Ready)

A lightweight React app for managers to enter and approve staff leave. Shows a campus-split Gantt chart and enforces per-campus concurrency limits (on *Approved* items).

## Features
- Excel/CSV import with column mapping (uses `xlsx`)
- Approval workflow: Pending → Approved/Declined (records approver & timestamp)
- Gantt calendar grouped by campus, adjustable date window
- Filters for Campus, Status, Role
- Per-campus max concurrent Approved (prevents overlapping approvals)
- Local storage persistence + JSON import/export

## Quick Start (Local)
```bash
npm install
npm run dev
```
Open http://localhost:5173

## Deploy to Vercel
1. Push this folder to a new GitHub repo (or use Vercel's drag-and-drop).
2. On Vercel: New Project → Import your repo.
3. Build Command: `npm run build`
4. Output Directory: `dist`
5. Deploy → Share the generated URL.

> Tailwind CSS is included via the CDN in `index.html` for simplicity.

## Notes
- No authentication. Anyone with the URL can use it.
- Data is stored in each user's browser (localStorage). Use JSON export/import to share snapshots if needed.
