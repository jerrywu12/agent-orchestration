# Data model
Project: id,name,key,path,repo,githubProjectNumber,githubProjectId,statusFieldId,stageMapping.
Stage: id,projectId,name,color,role(backlog/planning/active/review/done/parked),position,autoStart.
Agent: id,name,color,adapter,captured capabilities,enabled. Token secrets never exposed.
Ticket: id,projectId,number,title,description,stageId,ownerId,priority(urgent/high/medium/low/none),
labels,parentId,dependsOn,blockedReason,archived,version,createdAt,updatedAt,github,execution.
Execution: id,ticketId,agentId,sessionId,state,progress(nullable),summary,heartbeatAt,branch,
worktreePath,prUrl,headSha,lastSeq,releasedAt,external. Only one unreleased execution per ticket.
Activity: id,ticketId,kind,summary,at,agentId. Event ids unique per execution, seq increasing.
GitHub ticket data: number,url,nodeId,projectItemId,baseline,dirty,syncState,error,conflict.
Sync jobs: durable ticket id, attempt count, retryAt,state; no plaintext tokens.
Migration: source identity, original project/ticket id, snapshot metadata, reconciliation counts.
