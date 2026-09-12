# Frozen intake API and UI contract

All paths below are relative to /api. Existing API error envelope and Host/Origin/admin guards apply. `capabilities.localMode` remains; no client path is inferred from a browser File object.

## Attachments
- POST /attachments: JSON {name:string,contentBase64:string}. Route body limit 14 MiB; original 10 MiB. Process locally then persist draft. 201 Attachment with text included.
- GET /attachments/:id: Attachment with text. Admin may read drafts; scoped agent may read only when bound to its assigned ticket.
- GET /attachments/:id/download: same authorization, original byte download, nosniff, safe Content-Disposition attachment. No inline active rendering.
- DELETE /attachments/:id: admin-only draft deletion, 409 if already bound. Unknown/expired 404.
- POST /tickets additionally accepts attachmentIds:string[] (max5) and brief:TaskBrief. All IDs must be live unbound drafts, bound atomically or whole creation fails. Duplicate IDs rejected. Existing callers omitting fields remain valid.
- PATCH /tickets/:id additionally accepts brief; attachments stay immutable in this slice.
- State Ticket.attachments contains Attachment metadata only (omit text); GET /tickets/:id also returns attachmentContext:Attachment[] with text. Scoped agents gain only GET of their assigned ticket. MCP desk_get_task uses this endpoint.
- Draft expiry24h, max20 drafts, storage1GiB, concurrent parsers2. Failed parse returns safe 422 error and is not persisted. No OCR; no-text/encrypted documents explain remedy.

Attachment: {id,name,mediaType,size,sha256,createdAt,ticketId:string|null,text?:string,warnings:string[],pageCount?:number}. TaskBrief: {acceptanceCriteria:string,scope:string,verification:string}, each max10000 chars; defaults empty. Add optional Ticket.brief and Ticket.attachments/attachmentContext to TS contract. Agent execution packets label text as untrusted references and cap argv payload; full owned context remains API accessible. Attachments/brief are not automatically appended to GitHub descriptions.

## Folder selection
- GET /project-folders?path=ABS: admin direct-directory listing {path,parentPath:string|null,directories:{name,path}[],truncated:boolean,nativePicker:boolean}. Empty path defaults server home. Bounded200 entries; skip hidden dirs and symlinks. Safe errors for invalid/inaccessible paths.
- POST /project-folder/pick {}: loopback admin on darwin only; opens server Mac's chooser. Returns {cancelled:true} or FolderInspection. Single active picker; deadline/cancel are explicit. Remote/non-Mac gets 409 PICKER_UNAVAILABLE so UI offers server browse.
- POST /projects/inspect {path}: FolderInspection {path,name,key,repo,git:{isRepository:boolean,root:string|null,branch:string|null,hasHead:boolean,dirty:boolean},existingProjectId:string|null,warnings:string[]}.
- POST /projects with nonempty path: inspect canonical path/Git root again; auto-detect repo if input omitted/empty. Reuse existing project for canonical path, status200; create new status201. Preserve explicit user name/key and valid repo override. No repository writes.
- Frontend Browse opens server folder navigation; on Mac offer native Choose folder. Inspect result fills untouched name/key/repo and resolved path, shows branch/dirty/no-HEAD/non-Git warnings; existingProjectId permits Open existing project via onCreated.

## UI, workflow and PWA
Readability: exact +3px on current CSS sizes, identifiers fully visible including suffix at all widths; narrow rows may stack ID/title. New brief fields labelled Acceptance criteria, Scope, Verification plan. Details show context, original downloads, bounded previews, and checklist for ownership/holds/spec brief, execution, recorded checks/review/PR/SHA (unverified is explicit). Copy task packet works with clipboard fallback.
PWA InstallAppButton exports default/named InstallAppButton as agreed by worker; placed by frontend in sidebar. Manifest start_url=/, scope=/, stable id=/, standalone, proper 192/512 PNG icons. Network-first navigation with static offline fallback only; never cache /api, credentials or operational HTML/data. Existing service worker updates cannot serve stale bundles. No push notifications or background execution.
