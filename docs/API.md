# Conts ERP API

Base URL:
- local `http://localhost:8787`
- staging `https://conts-erp-api-staging.conts-erp.workers.dev`

## Signing in
The UI signs in with the **Supabase JS client** against the Conts Supabase project
(URL + anon key). Supabase returns an access token; send it on every call:

```
Authorization: Bearer <supabase access token>
```

The backend verifies the token, loads the profile, and loads every permission the
user holds. A missing profile, a deactivated account or an expired token is refused.

| Status | Meaning |
|---|---|
| 401 | No token, or it expired: sign in again |
| 403 | Signed in but missing the permission (the message names it) |
| 409 | Conflict, e.g. the email or code is already used |

## Endpoints
| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/health` | none | uptime check |
| GET | `/api/me` | signed in | profile, roles, permissions, allowed pages |
| GET | `/api/users` | `settings.users.view` | list users (`?q=`, `?include_inactive=true`) |
| GET | `/api/users/:id` | `settings.users.view` | one user with roles and photo link |
| POST | `/api/users/invite` | `settings.users.create` | invite by email; creates profile + roles |
| PATCH | `/api/users/:id` | `settings.users.edit` | name, staff code, phone, department, position, manager |
| PUT | `/api/users/:id/roles` | `settings.roles.manage` | replace a user's roles |
| POST | `/api/users/:id/deactivate` | `settings.users.deactivate` | block the login and hide from the chart |
| POST | `/api/users/:id/reactivate` | `settings.users.deactivate` | restore access |
| POST | `/api/users/:id/photo` | own photo, or `settings.users.edit` | raw JPEG/PNG/WebP body, max 2 MB |
| GET | `/api/roles` | `settings.roles.view` | roles with their permissions, pages and user counts |
| GET | `/api/roles/catalogue` | `settings.roles.view` | every permission and page, for the checkboxes |
| POST | `/api/roles` | `settings.roles.manage` | create a role |
| PUT | `/api/roles/:id/permissions` | `settings.roles.manage` | replace a role's permissions |
| PUT | `/api/roles/:id/pages` | `settings.roles.manage` | replace a role's menu pages |
| DELETE | `/api/roles/:id` | `settings.roles.manage` | delete a non-system, unused role |
| GET | `/api/departments` | `settings.departments.view` | list with staff counts |
| POST/PATCH/DELETE | `/api/departments[/:id]` | `settings.departments.manage` | create, edit, deactivate |
| GET | `/api/positions` | `settings.positions.view` | list |
| POST/PATCH | `/api/positions[/:id]` | `settings.positions.manage` | create, edit |
| GET | `/api/settings/company` | `settings.company.view` | company profile |
| PUT | `/api/settings/company` | `settings.company.edit` | update company profile |
| GET | `/api/settings/doc-numbers` | `settings.docnumbers.view` | numbering rules |
| PUT | `/api/settings/doc-numbers/:docType` | `settings.docnumbers.manage` | set prefix, padding, next number, reset |
| GET | `/api/settings/audit` | `settings.audit.view` | audit log (`?entity=`, `?actor_id=`, `?limit=`) |
| GET | `/api/org-chart` | `orgchart.view` | departments nested, each with people and photos |

## Built-in roles
| Role | What it can do |
|---|---|
| Owner | everything, including managing roles; always keeps every permission |
| Admin | everything except changing roles and permissions |
| Manager | read-only across settings and the org chart |
| Staff | organisation chart only |

## Notes for the UI
- Call `/api/me` after sign-in and build the menu from `pages`; hide buttons using `permissions`.
- Hiding a button is convenience only — the backend refuses the call regardless.
- Photo links from the API expire after an hour; re-fetch rather than storing them.
- New departments, positions, roles and users all come from these endpoints, and the
  org chart updates by itself.
